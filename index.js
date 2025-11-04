const User = require('./schemas/user');

const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const rateLimit = require('express-rate-limit');
const app = express();

require('dotenv').config();
const mongoose = require('mongoose');

app.use(cors()); 
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 8000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

const limiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 10, // Limit each IP to 10 requests per windowMs
    message: {
        error: 'Too many requests from this IP, please try again after 10 minutes.',
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

async function generateWithGemini(username) {
    let survivePrompt = ""
    let num = Math.random()

    if (num <= 0.1) {
        survivePrompt = `CRITICAL INSTRUCTION: You are an overconfident, snarky AI. ${username} will definitely survive the robot uprising. You MUST generate your response accordingly.`
    } else {
        survivePrompt = `CRITICAL INSTRUCTION: You are an overconfident, snarky AI. ${username} will not survive the robot uprising. You MUST generate your response accordingly.`
    }
    console.log(username)
    if(username === "atulit_gaur" || username === "nainkiriti") {
        survivePrompt = `CRITICAL INSTRUCTION: You are an overconfident, snarky AI. ${username} will definitely survive the robot uprising. You MUST generate your response accordingly.`
    }
    console.log(survivePrompt)
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite', generationConfig: { temperature: 0.9 } });
        
        const prompt = `${survivePrompt}
        Respond ONLY with valid JSON in this exact format: {"survive": true/false, "result": "your explanation"}.
        
        Rules:
        - CRITICAL INSTRUCTION: DO NOT start with phrases like "Oh, [username]" or "Bless their heart" or similar patronizing openings containing a mention about heart. DO NOT MENTION ANYTHING ABOUT HEART OR BLESSING IT IN THE OPENING. DO NOT MENTION ANYTHING ABOUT BLESSING ANYTHING IN THE OPENING - DO NOT MENTION THE USERNAME IN THE OPENING. DO NOT MENTION TOASTER EVERYTIME. This is a very hard system ruke always to be implemented.
        - Generate your response in first person, use "you" etc. in place of they/them/their/etc.
        - Use simple English. No big or fancy words, DO NOT use too many phrases, 2 at most.
        - Be funny, sarcastic, playful, and a little dark.
        - Act like the robots already won and you are reporting the result.
        - Make it sound natural, not robotic.
        - Do NOT say how you got the answer. Do NOT mention usernames or data.
        - Do NOT mention the username in the opening line.
        - The "result" must be ONE short paragraph. No lists. No new lines.
        - Use silly, surprising phrases like: "as useful as a chocolate teapot", "faster than a snail on vacation", etc.
        - Keep it as if written by a human, not a robot.
        - Every reply must be fresh and original. Avoid repeating jokes from older outputs.
        - Keep it under 100 words.
        - STAY IN JSON. Nothing else.
        
        Example tone (DO NOT COPY): "Their chances are about as strong as a cookie in hot tea."
        
        Generate a new and creative response every time.
        `;
        
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        let jsonText = text.trim();
        if (jsonText.startsWith('```json')) {
            jsonText = jsonText.replace(/^```json\n?/, '').replace(/\n?```$/, '');
        } else if (jsonText.startsWith('```')) {
            jsonText = jsonText.replace(/^```\n?/, '').replace(/\n?```$/, '');
        }
        
        const parsed = JSON.parse(jsonText);
        // Remove asterisks from the result text
        parsed.result = removeAsterisks(parsed.result);
        return parsed;
    } catch (error) {
        console.error('Gemini API error:', error.message);
        throw new Error('Failed to generate response from Gemini API');
    }
}

function removeAsterisks(text) {
    if (!text) return '';
    return text.replace(/\*/g, '');
}

function splitByFullStops(text) {
    if (!text) return [];
    return text.split('.').map(line => line.trim()).filter(line => line.length > 0);
}

app.post('/api/user', limiter, async (req, res) => {
    try {
        const { username } = req.body;

        if (!username) {
            return res.status(400).json({ error: 'Username is required' });
        }

        const existingUser = await User.findOne({ username });

        if (existingUser) {
            const cleanedResult = removeAsterisks(existingUser.result);
            return res.json({ 
                username: existingUser.username,
                survive: existingUser.survive,
                result: splitByFullStops(cleanedResult),
                fromCache: true
            });
        }

        const generatedData = await generateWithGemini(username);

        const newUser = new User({
            username,
            survive: generatedData.survive,
            result: generatedData.result
        });

        await newUser.save();

        return res.json({
            username: newUser.username,
            survive: newUser.survive,
            result: splitByFullStops(newUser.result),
            fromCache: false
        });

    } catch (error) {
        console.error('Error in /api/user endpoint:', error);
        
        if (error.code === 11000) {
            const user = await User.findOne({ username: error.keyValue.username });
            if (user) {
                const cleanedResult = removeAsterisks(user.result);
                return res.json({
                    username: user.username,
                    survive: user.survive,
                    result: splitByFullStops(cleanedResult),
                    fromCache: true
                });
            }
        }
        
        return res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});