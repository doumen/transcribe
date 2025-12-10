const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager, FileState } = require("@google/generative-ai/server");
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GEMINI_API_KEY;
const AUDIO_FILENAME = "audio.mp3"; 

// OPTION 1: Prioritize "PRO" models for better accuracy with accents/mixed languages
const MODEL_CANDIDATES = [
    "gemini-2.5-pro",            // Best for accuracy/reasoning
    "gemini-2.0-pro-exp-02-05",  // Very strong experimental model
    "gemini-1.5-pro",            // Stable Pro model
    "gemini-2.5-flash"           // Fallback if Pro fails
];

if (!API_KEY) {
    console.error("Error: GEMINI_API_KEY environment variable is not set.");
    process.exit(1);
}

if (!fs.existsSync(AUDIO_FILENAME)) {
    console.error(`\n❌ Error: The file '${AUDIO_FILENAME}' was not found.`);
    process.exit(1);
}

const fileManager = new GoogleAIFileManager(API_KEY);
const genAI = new GoogleGenerativeAI(API_KEY);

async function main() {
    try {
        console.log(`[1/4] Uploading ${AUDIO_FILENAME} (High Accuracy Mode)...`);
        
        const uploadResult = await fileManager.uploadFile(AUDIO_FILENAME, {
            mimeType: "audio/mp3",
            displayName: "Vaishnava Discourse Audio",
        });

        const fileUri = uploadResult.file.uri;
        let fileState = uploadResult.file.state;
        const name = uploadResult.file.name;

        console.log(`      Upload ID: ${name}`);
        console.log(`[2/4] Waiting for audio processing...`);

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

        console.log(`[3/4] Requesting transcription...`);
        
        let transcriptText = null;
        let activeModel = "";

        // OPTION 2: Better Prompting
        // We give Gemini context about the content (Hari Katha, mixed languages).
        const richPrompt = `
            Please provide a high-fidelity transcription of this audio file.
            
            **Context:** This is a Vaishnava spiritual discourse (Hari Katha).
            **Languages:** The audio contains mixed languages, primarily English, but may include Hindi, Bengali, and Sanskrit verses/mantras.
            
            **Instructions:**
            1. Transcribe the English exactly as spoken.
            2. For Sanskrit/Bengali verses, transcribe them phonetically in Roman characters (transliteration) if possible, or keep them in the original script if clear.
            3. Identify different speakers (e.g., 'Speaker', 'Devotee', 'Audience').
            4. Add timestamps [MM:SS] every time the topic shifts or every 2-3 minutes.
            5. Format the output cleanly with paragraphs.
        `;

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
                    { text: richPrompt },
                ]);
                
                const response = await result.response;
                transcriptText = response.text();
                activeModel = modelName;
                console.log("✅ Success!");
                break; 

            } catch (innerError) {
                console.log(`❌ Failed.`); 
                // Uncomment to debug specific error: console.log(innerError);
            }
        }

        if (!transcriptText) {
            throw new Error("All model candidates failed.");
        }

        const outputFilename = "transcript_pro.txt";
        fs.writeFileSync(outputFilename, transcriptText);
        
        console.log(`[4/4] Success using [${activeModel}]!`);
        console.log(`      Saved to: ${outputFilename}`);

    } catch (error) {
        console.error("\nFatal Error:", error.message);
    }
}

main();