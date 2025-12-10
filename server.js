const express = require('express');
const multer = require('multer');
const cors = require('cors'); // <--- NOVO
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager, FileState } = require("@google/generative-ai/server");
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Habilitar CORS para permitir que páginas Web acessem a API
app.use(cors()); // <--- IMPORTANTE

const upload = multer({ dest: 'uploads/' });
const API_KEY = process.env.GEMINI_API_KEY;

// Mesma lista de modelos do seu script anterior
const MODEL_CANDIDATES = [
    "gemini-2.5-flash",          
    "gemini-2.0-flash-exp",
    "gemini-2.0-flash",          
    "gemini-flash-latest",
    "gemini-1.5-flash"
];

// Servir a página HTML
app.get('/', (req, res) => {
    // Certifique-se de que o arquivo 'index.html' está na mesma pasta que server.js
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/transcribe', upload.single('audio'), async (req, res) => {
    // 1. Validações
    if (!API_KEY) return res.status(500).json({ error: "API Key não configurada." });
    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });

    const filePath = req.file.path;
    const mimeType = req.file.mimetype === 'application/octet-stream' ? 'audio/mp3' : req.file.mimetype;
    
    console.log(`\n[API] Recebido: ${req.file.originalname}`);

    try {
        const fileManager = new GoogleAIFileManager(API_KEY);
        const genAI = new GoogleGenerativeAI(API_KEY);

        // 2. Upload
        const uploadResult = await fileManager.uploadFile(filePath, {
            mimeType: mimeType,
            displayName: "Web API Audio",
        });

        const name = uploadResult.file.name;
        const fileUri = uploadResult.file.uri;
        let fileState = uploadResult.file.state;

        // 3. Processamento
        while (fileState === FileState.PROCESSING) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const fileStatus = await fileManager.getFile(name);
            fileState = fileStatus.state;
            if (fileState === FileState.FAILED) throw new Error("Processamento falhou no Google.");
        }

        // 4. Transcrição
        let transcriptText = null;
        let activeModel = "";

        const richPrompt = `
            STRICT INSTRUCTION: The output MUST be in the Roman alphabet (English letters) ONLY.
            DO NOT use Devanagari script.
            
            **Task:** Transcribe this audio file (Vaishnava spiritual discourse).
            **Rules:**
            1. Script: Roman alphabet ONLY.
            2. Transliterate Sanskrit/Bengali terms (e.g., "Krishna").
            3. Use paragraphs and occasional timestamps [MM:SS].
        `;

        for (const modelName of MODEL_CANDIDATES) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent([
                    { fileData: { mimeType: uploadResult.file.mimeType, fileUri: fileUri } },
                    { text: richPrompt },
                ]);
                const response = await result.response;
                transcriptText = response.text();
                activeModel = modelName;
                break;
            } catch (err) {
                console.log(`Falha no modelo ${modelName}`);
            }
        }

        if (!transcriptText) throw new Error("Todos os modelos falharam.");

        fs.unlinkSync(filePath);
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

app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});