const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager, FileState } = require("@google/generative-ai/server");
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GEMINI_API_KEY;

// 1. LER ARGUMENTOS (Corrige o problema de input/output ignorados)
const args = process.argv.slice(2);

if (args.length < 2) {
    console.error("\n❌ Erro: Argumentos insuficientes.");
    console.error("   Uso correto: node transcribe.js <arquivo_audio_entrada> <arquivo_texto_saida>");
    console.error("   Exemplo: node transcribe.js audio.mp3 transcricao.txt\n");
    process.exit(1);
}

const AUDIO_FILENAME = args[0];
const OUTPUT_FILENAME = args[1]; // Agora o output será salvo neste arquivo

// Priorizar modelos Pro para melhor obediência às instruções de idioma
const MODEL_CANDIDATES = [
    "gemini-2.5-pro",            
    "gemini-2.0-pro-exp-02-05",  
    "gemini-1.5-pro",            
    "gemini-2.5-flash"           
];

if (!API_KEY) {
    console.error("Erro: A variável de ambiente GEMINI_API_KEY não está definida.");
    process.exit(1);
}

if (!fs.existsSync(AUDIO_FILENAME)) {
    console.error(`\n❌ Erro: O arquivo de entrada '${AUDIO_FILENAME}' não foi encontrado.`);
    process.exit(1);
}

const fileManager = new GoogleAIFileManager(API_KEY);
const genAI = new GoogleGenerativeAI(API_KEY);

async function main() {
    try {
        console.log(`[1/4] Enviando '${AUDIO_FILENAME}' para o Google AI...`);
        
        const uploadResult = await fileManager.uploadFile(AUDIO_FILENAME, {
            mimeType: "audio/mp3",
            displayName: "Audio Transcription",
        });

        const fileUri = uploadResult.file.uri;
        let fileState = uploadResult.file.state;
        const name = uploadResult.file.name;

        console.log(`      ID do Upload: ${name}`);
        console.log(`[2/4] Aguardando processamento...`);

        while (fileState === FileState.PROCESSING) {
            process.stdout.write(".");
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const fileStatus = await fileManager.getFile(name);
            fileState = fileStatus.state;
            
            if (fileState === FileState.FAILED) {
                throw new Error("O processamento de áudio falhou nos servidores do Google.");
            }
        }
        console.log("\n      Áudio pronto!");

        console.log(`[3/4] Solicitando transcrição (Forçando Script Romano)...`);
        
        let transcriptText = null;
        let activeModel = "";

        // PROMPT RIGOROSO: Apenas caracteres Romanos/Ingleses
        const richPrompt = `
            STRICT INSTRUCTION: The output MUST be in the Roman alphabet (English letters) ONLY.
            DO NOT use Devanagari script (e.g., कृष्ण) or Bengali script.
            
            **Task:** Transcribe this audio file which is a Vaishnava spiritual discourse (Hari Katha).
            **Primary Language:** English (with Indian accent).
            
            **Rules:**
            1. **Script:** Write EVERYTHING in the Roman alphabet.
            2. **English:** Transcribe exactly as spoken.
            3. **Sanskrit/Bengali/Hindi Terms:** Use standard transliteration (e.g., write "Krishna" not "कृष्ण", write "Radha" not "राधा").
            4. **Speakers:** Identify speakers if distinct (e.g., 'Speaker', 'Devotee').
            5. **Formatting:** Use timestamps [MM:SS] every few minutes or at topic changes. Use paragraphs for readability.
            
            If the speaker recites a verse in Sanskrit, write it phonetically in English letters.
        `;

        for (const modelName of MODEL_CANDIDATES) {
            try {
                process.stdout.write(`      Tentando modelo: ${modelName}... `);
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
                console.log("✅ Sucesso!");
                break; 

            } catch (innerError) {
                console.log(`❌ Falhou.`);
            }
        }

        if (!transcriptText) {
            throw new Error("Todos os modelos candidatos falharam.");
        }

        // SALVAR NO ARQUIVO DE SAÍDA CORRETO
        fs.writeFileSync(OUTPUT_FILENAME, transcriptText);
        
        console.log(`[4/4] Sucesso usando [${activeModel}]!`);
        console.log(`      Salvo em: ${path.resolve(OUTPUT_FILENAME)}`);

    } catch (error) {
        console.error("\nErro Fatal:", error.message);
    }
}

main();