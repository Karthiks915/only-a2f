const express = require('express');
const axios = require('axios');
const fs = require('fs');
const wav = require('wav');
const app = express();

class Audio2FaceService {
    constructor() {
        this.baseUrl = 'http://localhost:8011';
        this.isInitialized = false;
        // We'll use a 1-second sample for initialization
        this.initSampleDuration = 1000; // milliseconds
    }

    async initialize(audioPath) {
        if (this.isInitialized) {
            return true;
        }

        try {
            // Read the audio file
            const reader = new wav.Reader();
            const audioStream = fs.createReadStream(audioPath).pipe(reader);

            // Wait for the format event
            await new Promise((resolve) => {
                reader.on('format', async (format) => {
                    // Get initial sample
                    const initBuffer = await this.getAudioSample(audioPath, this.initSampleDuration);
                    
                    // Send initial sample to A2F
                    await this.pushAudioTrack(initBuffer, format.sampleRate);
                    
                    // Enable StreamLivelink
                    await this.enableStreamLivelink();
                    
                    this.isInitialized = true;
                    resolve();
                });
            });

            return true;
        } catch (error) {
            console.error('Initialization failed:', error);
            return false;
        }
    }

    async pushAudioTrack(audioBuffer, sampleRate) {
        const url = `${this.baseUrl}/A2F/Player/PushAudioStream`;
        const payload = {
            audio_data: audioBuffer.toString('base64'),
            sample_rate: sampleRate,
            instance: '/World/audio2face/Player'
        };

        return axios.post(url, payload);
    }

    async enableStreamLivelink() {
        const url = `${this.baseUrl}/A2F/Exporter/Act`;
        const payload = {
            node_path: '/World/audio2face/StreamLivelink',
            value: true
        };

        return axios.post(url, payload);
    }

    async getAudioSample(audioPath, duration) {
        // Implementation to get first 'duration' ms of audio
        // This is a simplified version - you might want to use a proper audio processing library
        const reader = new wav.Reader();
        const stream = fs.createReadStream(audioPath).pipe(reader);
        
        return new Promise((resolve) => {
            const chunks = [];
            reader.on('data', chunk => chunks.push(chunk));
            reader.on('end', () => {
                const buffer = Buffer.concat(chunks);
                // Get only the first portion based on duration
                resolve(buffer.slice(0, duration));
            });
        });
    }

    async streamAudio(audioPath) {
        if (!await this.initialize(audioPath)) {
            throw new Error('Failed to initialize Audio2Face');
        }

        const reader = new wav.Reader();
        const stream = fs.createReadStream(audioPath).pipe(reader);

        reader.on('format', format => {
            const chunkSize = format.sampleRate * format.bytesPerSample; // 1 second chunks
            let chunks = [];

            reader.on('data', async (chunk) => {
                chunks.push(chunk);
                if (Buffer.concat(chunks).length >= chunkSize) {
                    const audioChunk = Buffer.concat(chunks);
                    await this.pushAudioTrack(audioChunk, format.sampleRate);
                    chunks = [];
                }
            });

            reader.on('end', async () => {
                if (chunks.length > 0) {
                    const audioChunk = Buffer.concat(chunks);
                    await this.pushAudioTrack(audioChunk, format.sampleRate);
                }
            });
        });
    }
}

// Express server setup
app.use(express.json());

const a2fService = new Audio2FaceService();

app.post('/stream-audio', async (req, res) => {
    try {
        const { audioPath } = req.body;
        if (!audioPath) {
            return res.status(400).json({ error: 'Audio path is required' });
        }

        await a2fService.streamAudio(audioPath);
        res.json({ message: 'Streaming started successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
