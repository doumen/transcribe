Como Publicar o teu Servidor Gratuitamente (Render.com)

Como o teu servidor processa áudio, ele precisa de um ambiente que não "congele" imediatamente. O plano gratuito ("Free Web Service") do Render é ideal para isto.

Passo 1: Preparar o Código no GitHub

Certifica-te de ter os seguintes ficheiros na tua pasta:

server.js (O código do servidor).

package.json (O ficheiro de configuração gerado anteriormente).

Cria um repositório no GitHub.

Envia os teus ficheiros para lá (se não souberes usar Git, podes fazer upload manual arrastando os ficheiros para a página do repositório no navegador).

Importante: NÃO envies a pasta node_modules nem ficheiros .env com as tuas senhas. O Render vai instalar as dependências automaticamente baseado no package.json.

Passo 2: Criar o Serviço no Render

Cria uma conta em render.com.

No painel (Dashboard), clica em New + e seleciona Web Service.

Conecta a tua conta do GitHub e seleciona o repositório que acabaste de criar.

Preenche o formulário com estes dados:

Name: minha-transcricao-api (ou qualquer nome à tua escolha).

Region: Escolhe a mais próxima (ex: Ohio ou Frankfurt).

Branch: main (ou master).

Root Directory: Deixa em branco.

Runtime: Node.

Build Command: npm install (O padrão deve estar correto).

Start Command: node server.js (O padrão deve pegar do package.json, mas garante que seja este).

Instance Type: Seleciona Free.

Passo 3: Configurar a Chave de API (Segurança)

Não coloques a tua chave no código público! Usa as Variáveis de Ambiente do Render para segurança.

Ainda na página de configuração (ou na aba "Environment" depois de criado):

Clica em Add Environment Variable.

Preenche:

Key: GEMINI_API_KEY

Value: Cola_Aqui_A_Tua_Chave_AIza... (A mesma que usaste no terminal).

Clica em Create Web Service.

Passo 4: Testar

O Render vai levar alguns minutos para construir e iniciar o servidor. Quando terminar, ele mostrará uma URL no topo (algo como https://minha-transcricao.onrender.com).

Para testar a partir do teu computador:

Abre o terminal e envia um áudio para o teu novo link (substitui a URL pela tua):

curl -X POST -F "audio=@seu_audio.mp3" [https://minha-transcricao.onrender.com/transcribe](https://minha-transcricao.onrender.com/transcribe)


Nota: No plano gratuito, o servidor "adormece" após inatividade. A primeira requisição pode demorar uns 50 segundos para acordá-lo.