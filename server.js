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

// 1. Configuração de Segurança (CORS)
app.use(cors());

// 2. Configuração de Upload (Pasta Temporária)
const upload = multer({ dest: 'uploads/' });

// 3. API Key (Lida das variáveis de ambiente)
const API_KEY = process.env.GEMINI_API_KEY;

// Rota Principal: Entrega o site (index.html)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Rota da API: Recebe o áudio e transcreve
app.post('/transcribe', upload.single('audio'), async (req, res) => {
    
    // Verificações Iniciais
    if (!API_KEY) {
        console.error("❌ ERRO: API_KEY não encontrada.");
        return res.status(500).json({ error: "Servidor mal configurado (Falta API Key)." });
    }

    if (!req.file) {
        return res.status(400).json({ error: "Nenhum arquivo de áudio enviado." });
    }

    // --- CONFIGURAÇÕES DO PEDIDO ---
    const filePath = req.file.path;
    const selectedModel = req.body.model || "gemini-2.5-flash"; // Modelo escolhido no HTML
    
    // CORREÇÃO CRÍTICA PARA ARQUIVOS DE ÁUDIO
    let mimeType = req.file.mimetype;
    if (mimeType === 'application/octet-stream') mimeType = 'audio/mp3'; // Fix para Windows
    if (mimeType === 'application/ogg') mimeType = 'audio/ogg'; // Fix para WhatsApp/OGG
    
    console.log(`\n[API] Processando: ${req.file.originalname}`);
    console.log(`      Tipo: ${mimeType} | Modelo: ${selectedModel}`);

    try {
        const fileManager = new GoogleAIFileManager(API_KEY);
        const genAI = new GoogleGenerativeAI(API_KEY);

        // 1. Upload para o Google
        console.log("   -> Enviando arquivo para a nuvem...");
        const uploadResult = await fileManager.uploadFile(filePath, {
            mimeType: mimeType,
            displayName: "Audio Transcription",
        });

        const name = uploadResult.file.name;
        const fileUri = uploadResult.file.uri;
        let fileState = uploadResult.file.state;

        // 2. Polling (Esperar o Google processar o áudio)
        console.log("   -> Aguardando processamento...");
        while (fileState === FileState.PROCESSING) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const fileStatus = await fileManager.getFile(name);
            fileState = fileStatus.state;
            
            if (fileState === FileState.FAILED) {
                throw new Error("O Google falhou ao processar o áudio (FileState: FAILED).");
            }
        }

        // 3. Solicitar Transcrição
        console.log(`   -> Solicitando transcrição ao ${selectedModel}...`);
        
        const richPrompt = `
            STRICT INSTRUCTION: The output MUST be in the Roman alphabet (English letters) ONLY.
            DO NOT use Devanagari script. Use standard transliteration for Sanskrit terms.
            
            **Task:** Transcribe this audio file exactly as spoken.
            **Formatting:** Use paragraphs. Add timestamps [MM:SS] occasionally.
        `;

        const model = genAI.getGenerativeModel({ model: selectedModel });
        
        const result = await model.generateContent([
            { fileData: { mimeType: uploadResult.file.mimeType, fileUri: fileUri } },
            { text: richPrompt },
        ]);
        
        const response = await result.response;
        const transcriptText = response.text();
        console.log("✅ SUCESSO!");

        // 4. Limpeza Local
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        
        // (Opcional) Limpeza Remota
        // await fileManager.deleteFile(name);

        res.json({
            status: "success",
            model: selectedModel,
            transcription: transcriptText
        });

    } catch (error) {
        console.error("❌ ERRO:", error.message);
        
        // Limpar arquivo local se der erro
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        
        // Traduzir erros comuns para o usuário
        let userMsg = error.message;
        if (error.message.includes("429")) {
            userMsg = "⚠️ Limite de cota atingido (Erro 429)! O Google bloqueou temporariamente. Aguarde 1 minuto.";
        } else if (error.message.includes("404")) {
            userMsg = `⚠️ O modelo '${selectedModel}' não está disponível para sua chave/região. Tente outro modelo.`;
        } else if (error.message.includes("400")) {
            userMsg = "⚠️ Formato de arquivo inválido ou não suportado pelo Gemini.";
        }

        res.status(500).json({ error: userMsg });
    }
});

// Iniciar Servidor
app.listen(port, () => {
    console.log(`\n🚀 Servidor rodando na porta ${port}`);
});