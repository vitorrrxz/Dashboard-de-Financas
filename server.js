import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PluggyClient } from 'pluggy-sdk';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

// Initialize Pluggy SDK
const pluggyClient = new PluggyClient({
  clientId: process.env.PLUGGY_CLIENT_ID || '',
  clientSecret: process.env.PLUGGY_CLIENT_SECRET || '',
});

app.post('/api/pluggy/token', async (req, res) => {
  try {
    const data = await pluggyClient.createConnectToken();
    res.json({ accessToken: data.accessToken });
  } catch (error) {
    console.error('Error generating pluggy connect token', error);
    res.status(500).json({ error: 'Failed to generate token', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(\`Pluggy Backend Server running on http://localhost:\${PORT}\`);
});
