const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager, FileState } = require("@google/generative-ai/server");
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

const upload = multer({ dest: 'uploads/' });
const API_KEY = process.env.GEMINI_API_KEY;

// Lista de modelos
const MODEL_CANDIDATES = [
    "gemini-2.5-flash",          
    "gemini-2.0-flash-exp",
    "gemini-1.5-flash",
    "gemini-flash-latest"
];

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/transcribe', upload.single('audio'), async (req, res) => {
    
    if (!API_KEY) {
        console.error("❌ ERRO: API_KEY ausente.");
        return res.status(500).json({ error: "Servidor sem API Key configurada." });
    }

    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });

    const filePath = req.file.path;
    
    // --- CORREÇÃO DO MIME TYPE (O Pulo do Gato) ---
    // O Gemini rejeita 'application/ogg', então forçamos 'audio/ogg'
    let mimeType = req.file.mimetype;
    if (mimeType === 'application/octet-stream') mimeType = 'audio/mp3';
    if (mimeType === 'application/ogg') mimeType = 'audio/ogg'; // <--- CORREÇÃO AQUI
    
    console.log(`\n[API] Processando: ${req.file.originalname} (Como: ${mimeType})`);

    try {
        const fileManager = new GoogleAIFileManager(API_KEY);
        const genAI = new GoogleGenerativeAI(API_KEY);

        console.log("   -> Enviando arquivo...");
        const uploadResult = await fileManager.uploadFile(filePath, {
            mimeType: mimeType,
            displayName: "API Request Audio",
        });

        const name = uploadResult.file.name;
        const fileUri = uploadResult.file.uri;
        let fileState = uploadResult.file.state;

        console.log("   -> Aguardando conversão...");
        while (fileState === FileState.PROCESSING) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const fileStatus = await fileManager.getFile(name);
            fileState = fileStatus.state;
            if (fileState === FileState.FAILED) throw new Error("Google falhou ao processar o áudio.");
        }

        console.log("   -> Iniciando transcrição...");
        let transcriptText = null;
        let activeModel = "";

        const richPrompt = `
            STRICT INSTRUCTION: The output MUST be in the Roman alphabet (English letters) ONLY.
            DO NOT use Devanagari script. Use standard transliteration for Sanskrit terms.
            Transcribe exactly as spoken. Use paragraphs.
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
                console.log("✅ SUCESSO!");
                break;
            } catch (err) {
                console.log("❌ FALHOU");
                const msg = err.message || JSON.stringify(err);
                
                // NOVO: Proteção contra bloqueio de Cota
                if (msg.includes("429")) {
                    console.error("         -> Cota excedida! Parando tentativas para não bloquear a chave.");
                    throw new Error("Limite de cota atingido (429). Tente novamente em 1 minuto.");
                } else {
                    console.error(`         -> Erro: ${msg.substring(0, 100)}...`);
                    // Espera 1s antes de tentar o próximo modelo (se não for cota)
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }

        if (!transcriptText) throw new Error("Todos os modelos falharam.");

        // Limpeza
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        
        res.json({
            status: "success",
            model: activeModel,
            transcription: transcriptText
        });

    } catch (error) {
        console.error("Erro Fatal:", error.message);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        
        // Retorna erro amigável para o front-end
        const userMsg = error.message.includes("429") ? "Limite de cota excedido. Aguarde 1 minuto." : error.message;
        res.status(500).json({ error: userMsg });
    }
});

app.listen(port, () => {
    console.log(`Servidor iniciado na porta ${port}`);
});