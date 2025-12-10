const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager, FileState } = require("@google/generative-ai/server");
const fs = require('fs');
const path = require('path');

// 1. Setup Configuration
// This reads the key you set in PowerShell ($Env:GEMINI_API_KEY)
const API_KEY = process.env.GEMINI_API_KEY;
const AUDIO_FILENAME = process.argv[2] || "audio-hindi.mp3";
const TRANSCRIPT_FILENAME = process.argv[3] || "transcript-hindi.txt"; 

// UPDATED: Prioritizing models available in your region (based on your log)
// It will try these in order until one works.
const MODEL_CANDIDATES = [
    "gemini-2.5-flash",          // Your best/newest available model
    "gemini-2.0-flash-exp",      // Experimental flash (very fast)
    "gemini-2.0-flash",          // Stable 2.0
    "gemini-flash-latest"        // Generic fallback
];

if (!API_KEY) {
    console.error("Error: GEMINI_API_KEY environment variable is not set.");
    process.exit(1);
}

// Check if file exists before running to prevent crashes
if (!fs.existsSync(AUDIO_FILENAME)) {
    console.error(`\n❌ Error: The file '${AUDIO_FILENAME}' was not found in this folder.`);
    console.error(`   Please ensure your audio file is named '${AUDIO_FILENAME}' and is in the same folder as this script.\n`);
    process.exit(1);
}

const fileManager = new GoogleAIFileManager(API_KEY);
const genAI = new GoogleGenerativeAI(API_KEY);

async function main() {
    try {
        console.log(`[1/4] Uploading ${AUDIO_FILENAME} to Google AI...`);
        
        // 2. Upload the file
        const uploadResult = await fileManager.uploadFile(AUDIO_FILENAME, {
            mimeType: "audio/mp3",
            displayName: "Audio Transcription Task",
        });

        const fileUri = uploadResult.file.uri;
        let fileState = uploadResult.file.state;
        const name = uploadResult.file.name;

        console.log(`      Upload ID: ${name}`);
        console.log(`[2/4] Waiting for audio processing...`);

        // 3. Poll until the file is ACTIVE
        while (fileState === FileState.PROCESSING) {
            process.stdout.write(".");
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const fileStatus = await fileManager.getFile(name);
            fileState = fileStatus.state;
            
            if (fileState === FileState.FAILED) {
                throw new Error("Audio processing failed on Google servers.");
            }
        }
        console.log("\n      Audio is ready!");

        // 4. Request Transcription (Self-Healing Loop)
        console.log(`[3/4] Requesting transcription...`);
        
        let transcriptText = null;
        let activeModel = "";

        for (const modelName of MODEL_CANDIDATES) {
            try {
                process.stdout.write(`      Trying model: ${modelName}... `);
                const model = genAI.getGenerativeModel({ model: modelName });
                
                const result = await model.generateContent([
                    {
                        fileData: {
                            mimeType: uploadResult.file.mimeType,
                            fileUri: fileUri
                        }
                    },
                    { 
                        text: "Transcribe this audio file exactly as spoken. Identify speakers if distinct. Format with timestamps every few paragraphs." 
                    },
                ]);
                
                const response = await result.response;
                transcriptText = response.text();
                activeModel = modelName;
                console.log("✅ Success!");
                break; // Stop loop on success

            } catch (innerError) {
                console.log(`❌ Failed.`);
                // Continue to next model in the list
            }
        }

        if (!transcriptText) {
            throw new Error("All model candidates failed. Please check your API limits or network.");
        }

        // 5. Save to file
        fs.writeFileSync(TRANSCRIPT_FILENAME, transcriptText);
        
        console.log(`[4/4] Success using [${activeModel}]!`);
        console.log(`      Transcript saved to: ${path.resolve(TRANSCRIPT_FILENAME)}`);
        
        // Optional: Cleanup file from server to save space
        // await fileManager.deleteFile(name);

    } catch (error) {
        console.error("\nFatal Error:", error.message);
    }
}

main();