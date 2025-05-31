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
  messages: [{
    role: String,
    content: String,
    timestamp: { type: Date, default: Date.now }
  }],
  timestamp: { type: Date, default: Date.now }
});

const History = mongoose.model('History', historySchema);

// OpenAI Configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

// Ruta principal - Reconocimiento y Guardado en Historial (Adaptada para chat)
app.post('/api/recognize', async (req, res) => {
  console.log('Recognize route hit (chat mode)');
  
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      console.log('No messages array provided or array is empty');
      return res.status(400).json({ error: 'An array of messages is required' });
    }

    console.log('Received messages:', messages);

    // Call OpenAI API with the message history
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messages,
      temperature: 0.7, // Añadimos temperatura para hacer las respuestas más creativas
      max_tokens: 150 // Limitamos la longitud de las respuestas
    });

    const responseContent = completion.choices[0].message.content;
    console.log('OpenAI response:', responseContent);
    
    const resultToSave = {
      details: {
        mainInfo: responseContent
      }
    };

    // Guardar la conversación completa en el historial
    const historyEntry = new History({
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        timestamp: new Date()
      })),
      timestamp: new Date()
    });

    await historyEntry.save();
    console.log('History entry saved:', historyEntry._id);

    res.json(resultToSave);
  } catch (error) {
    console.error('Error in /api/recognize:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Ruta para obtener historial de chat
app.get('/api/history', async (req, res) => {
  console.log('History route hit');
  try {
    const history = await History.find()
      .sort({ timestamp: -1 })
      .limit(10)
      .select('messages timestamp');
    
    console.log('Sending history:', history.length, 'entries');
    res.json(history);
  } catch (error) {
    console.error('Error fetching history:', error);
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
  console.log('- GET  /api/history'); // Added history route to logs
  console.log('========================================');
}); 