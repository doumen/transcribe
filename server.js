const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager, FileState } = require("@google/generative-ai/server");
const fs = require('fs');
const path = require('path');
require('dotenv').config(); // Caso use arquivo .env

// --- CONFIGURAÇÃO ---
const app = express();
const port = process.env.PORT || 3000;
const upload = multer({ dest: 'uploads/' }); // Pasta temporária
const API_KEY = process.env.GEMINI_API_KEY;

// Lista de modelos (Sincronizada com seu transcribe.js)
const MODEL_CANDIDATES = [
    "gemini-2.5-flash",          
    "gemini-2.0-flash-exp",
    "gemini-2.0-flash",          
    "gemini-flash-latest",
    "gemini-1.5-flash"
];

// --- ROTA DE TRANSCRIÇÃO ---
app.post('/transcribe', upload.single('audio'), async (req, res) => {
    
    // 1. Validações
    if (!API_KEY) return res.status(500).json({ error: "API Key não configurada no servidor." });
    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo de áudio enviado." });

    const filePath = req.file.path;
    // Tenta detectar mimetype ou usa mp3 como fallback
    const mimeType = req.file.mimetype === 'application/octet-stream' ? 'audio/mp3' : req.file.mimetype;
    
    console.log(`\n[API] Recebido: ${req.file.originalname} (${mimeType})`);

    try {
        const fileManager = new GoogleAIFileManager(API_KEY);
        const genAI = new GoogleGenerativeAI(API_KEY);

        // 2. Upload para o Google
        console.log("   -> Enviando para Google AI...");
        const uploadResult = await fileManager.uploadFile(filePath, {
            mimeType: mimeType,
            displayName: "API Request Audio",
        });

        const name = uploadResult.file.name;
        const fileUri = uploadResult.file.uri;
        let fileState = uploadResult.file.state;

        // 3. Aguardar Processamento
        console.log("   -> Processando...");
        while (fileState === FileState.PROCESSING) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const fileStatus = await fileManager.getFile(name);
            fileState = fileStatus.state;
            if (fileState === FileState.FAILED) throw new Error("Falha no processamento do áudio pelo Google.");
        }

        // 4. Loop de Tentativas (Self-Healing)
        console.log("   -> Transcrevendo...");
        let transcriptText = null;
        let activeModel = "";

        const richPrompt = `
            STRICT INSTRUCTION: The output MUST be in the Roman alphabet (English letters) ONLY.
            DO NOT use Devanagari script (e.g., कृष्ण) or Bengali script.
            
            **Task:** Transcribe this audio file (Vaishnava spiritual discourse/Hari Katha).
            **Rules:**
            1. Script: Roman alphabet ONLY.
            2. Transliterate Sanskrit/Bengali terms (e.g., "Krishna", not "कृष्ण").
            3. Use paragraphs and occasional timestamps [MM:SS].
        `;

        for (const modelName of MODEL_CANDIDATES) {
            try {
                process.stdout.write(`      Tentando ${modelName}... `);
                const model = genAI.getGenerativeModel({ model: modelName });
                
                const result = await model.generateContent([
                    { fileData: { mimeType: uploadResult.file.mimeType, fileUri: fileUri } },
                    { text: richPrompt },
                ]);
                
                const response = await result.response;
                transcriptText = response.text();
                activeModel = modelName;
                console.log("✅ OK!");
                break;
            } catch (err) {
                console.log("❌");
            }
        }

        if (!transcriptText) throw new Error("Todos os modelos falharam (Cota ou Erro).");

        // 5. Sucesso
        fs.unlinkSync(filePath); // Apaga arquivo local
        res.json({
            status: "success",
            model: activeModel,
            transcription: transcriptText
        });

    } catch (error) {
        console.error("Erro:", error.message);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.status(500).json({ error: error.message });
    }
});

// Iniciar
app.listen(port, () => {
    console.log(`\n🚀 Servidor rodando em http://localhost:${port}`);
    console.log(`   POST /transcribe (form-data: "audio")`);
});