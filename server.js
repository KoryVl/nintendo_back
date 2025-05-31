const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const OpenAI = require('openai');
const mongoose = require('mongoose');

dotenv.config();

const app = express();

// Middleware básico
app.use(cors());
app.use(express.json());

// Log middleware detallado
app.use((req, res, next) => {
  console.log('----------------------------------------');
  console.log(`${new Date().toISOString()}`);
  console.log(`${req.method} ${req.url}`);
  console.log('Headers:', req.headers);
  // No log body in production for security/privacy
  if (process.env.NODE_ENV !== 'production') {
    console.log('Body:', req.body);
  }
  console.log('----------------------------------------');
  next();
});

// MongoDB Connection
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/nintendo_explorer';

mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Define Schema and Model for History
const historySchema = new mongoose.Schema({
  conversation: [{
    role: String,
    content: String,
    timestamp: { type: Date, default: Date.now }
  }],
  lastUpdated: { type: Date, default: Date.now }
});

const History = mongoose.model('History', historySchema);

// OpenAI Configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Función para procesar mensajes con OpenAI
async function processMessage(messages) {
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('An array of messages is required');
  }

  console.log('Processing messages with OpenAI:', messages);

  const completion = await openai.chat.completions.create({
    model: "gpt-4",
    messages: messages,
    temperature: 0.7,
    max_tokens: 200
  });

  const responseContent = completion.choices[0].message.content;
  console.log('OpenAI response:', responseContent);

  return {
    details: {
      mainInfo: responseContent
    }
  };
}

// Ruta de prueba simple
app.get('/', (req, res) => {
  console.log('Root route hit');
  res.json({ message: 'Server is running!' });
});

// Ruta de prueba API
app.get('/api/test', (req, res) => {
  console.log('Test route hit');
  res.json({ message: 'API is working!' });
});

// Ruta para procesar mensajes y guardar/actualizar historial
app.post('/api/recognize', async (req, res) => {
  try {
    const { messages, chatId } = req.body;
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'An array of messages is required' });
    }

    let historyEntry;

    if (chatId) {
      // Si se proporciona un chatId, buscar y actualizar el historial existente
      historyEntry = await History.findById(chatId);
      if (!historyEntry) {
        return res.status(404).json({ error: 'Chat not found' });
      }
    } else {
      // Si no hay chatId, crear una nueva entrada de historial
      historyEntry = new History({
        conversation: [],
        lastUpdated: new Date()
      });
    }
    
    // Procesar el mensaje y obtener la respuesta de la IA
    // Se envía todo el historial para que la IA mantenga el contexto
    const resultToSave = await processMessage(messages);

    // Agregar el último mensaje del usuario y la respuesta de la IA a la conversación
    const lastUserMessage = messages.find(msg => msg.role === 'user' && msg.content === req.body.messages[req.body.messages.length - 1].content); // Asegurarse de tomar el último mensaje de usuario enviado en este request
    
    if(lastUserMessage) {
      historyEntry.conversation.push({
        role: lastUserMessage.role,
        content: lastUserMessage.content,
        timestamp: new Date()
      });
    }

    const aiResponse = {
      role: 'assistant',
      content: resultToSave.details.mainInfo,
      timestamp: new Date()
    };
    historyEntry.conversation.push(aiResponse);
    
    // Actualizar timestamp de última modificación
    historyEntry.lastUpdated = new Date();
    
    await historyEntry.save();
    console.log('History entry saved/updated:', historyEntry._id);

    // Devolver la respuesta de la IA y el chatId (nuevo o existente)
    res.json({
      aiResponse: resultToSave,
      chatId: historyEntry._id
    });

  } catch (error) {
    console.error('Error in /api/recognize:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Ruta para obtener una lista de historiales (para la barra lateral, por ejemplo)
app.get('/api/history', async (req, res) => {
  console.log('List history route hit');
  try {
    // Obtener todas las entradas de historial, mostrando solo un resumen
    const historyList = await History.find()
      .sort({ lastUpdated: -1 })
      .select('_id conversation lastUpdated'); // Seleccionar solo los campos necesarios
    
    // Formatear la lista para incluir un título basado en el primer mensaje de usuario
    const formattedHistory = historyList.map(chat => {
      const firstUserMessage = chat.conversation.find(msg => msg.role === 'user');
      const title = firstUserMessage ? firstUserMessage.content.substring(0, 50) + (firstUserMessage.content.length > 50 ? '...' : '') : 'Nuevo Chat';
      return {
        _id: chat._id,
        title: title,
        lastUpdated: chat.lastUpdated
      };
    });

    console.log('Sending history list:', formattedHistory.length, 'entries');
    res.json(formattedHistory);
  } catch (error) {
    console.error('Error fetching history list:', error);
    res.status(500).json({
      error: 'Error fetching history list',
      message: error.message
    });
  }
});

// Ruta para obtener los detalles completos de un historial específico
app.get('/api/history/:chatId', async (req, res) => {
  const chatId = req.params.chatId;
  console.log(`Fetching history for chat ID: ${chatId}`);
  try {
    const historyEntry = await History.findById(chatId);
    
    if (!historyEntry) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    console.log('Sending full history for chat ID:', chatId);
    res.json(historyEntry);
  } catch (error) {
    console.error(`Error fetching history for chat ID ${chatId}:`, error);
    res.status(500).json({
      error: 'Error fetching history',
      message: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error caught by middleware:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Available routes:');
  console.log('- GET  /');
  console.log('- GET  /api/test');
  console.log('- POST /api/recognize');
  console.log('- GET  /api/history');
  console.log('- GET  /api/history/:chatId');
  console.log('========================================');
}); 