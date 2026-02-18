import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function setupLogWriter(app) {
  app.post('/api/logs/save', express.json(), async (req, res) => {
    try {
      const { content, fileName } = req.body;

      if (!content || !fileName) {
        return res.status(400).json({ error: 'Content and fileName are required' });
      }

      // Save to project logs directory
      const logsDir = path.join(__dirname, '..', 'logs');

      // Create logs directory if it doesn't exist
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      // Write the log file
      const filePath = path.join(logsDir, fileName);
      fs.writeFileSync(filePath, content, 'utf-8');

      console.log(`✅ Log saved to: ${filePath}`);

      res.json({
        success: true,
        message: `Log saved to logs/${fileName}`,
        path: filePath
      });
    } catch (error) {
      console.error('Error saving log:', error);
      res.status(500).json({ error: 'Failed to save log file' });
    }
  });
}