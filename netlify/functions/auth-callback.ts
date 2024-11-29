import { Handler } from '@netlify/functions';
import axios from 'axios';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

// Initialize SQLite database
async function initializeDatabase() {
  const dbPath = path.join(__dirname, '../../../database/tokens.sqlite');
  console.log('Opening database at:', dbPath);
  
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS tokens (
      user_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  return db;
}

const handler: Handler = async (event) => {
  if (!event.queryStringParameters) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'No query parameters provided' })
    };
  }

  const { code, state } = event.queryStringParameters;

  if (!code) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'No code provided' })
    };
  }

  try {
    // Exchange code for access token
    const tokenResponse = await axios.post('https://api.producthunt.com/v2/oauth/token', {
      client_id: process.env.PRODUCTHUNT_CLIENT_ID,
      client_secret: process.env.PRODUCTHUNT_CLIENT_SECRET,
      code,
      redirect_uri: process.env.PRODUCTHUNT_REDIRECT_URI,
      grant_type: 'authorization_code'
    });

    const { access_token, refresh_token } = tokenResponse.data;

    console.log('Token response:', JSON.stringify(tokenResponse.data, null, 2));

    console.log('Starting GraphQL request with token:', access_token);

    // Get user info using the access token
    const userResponse = await axios.post(
      'https://api.producthunt.com/v2/api/graphql',
      {
        query: `
          {
            viewer {
              user {
                id
                name
                username
                profileImage
              }
            }
          }
        `
      },
      {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    ).catch(error => {
      console.error('GraphQL request failed:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        error: error.message
      });
      throw error;
    });

    console.log('Raw user response:', userResponse);
    console.log('User response data:', JSON.stringify(userResponse.data, null, 2));
    console.log('User response status:', userResponse.status);
    console.log('User response headers:', userResponse.headers);

    if (!userResponse.data?.data?.viewer?.user) {
      console.error('Invalid response structure:', userResponse.data);
      throw new Error('Failed to get user data: ' + JSON.stringify(userResponse.data));
    }

    const user = userResponse.data.data.viewer.user;
    const userId = state; // state contains the Telegram user ID

    // Save token using Python API
    try {
      await axios.post(`${process.env.PYTHON_API_URL}/save_token`, {
        user_id: userId,
        access_token: access_token,
        refresh_token: refresh_token,
        user_data: {
          name: user.name,
          username: user.username
        }
      });
      console.log('Token saved to Python storage');
    } catch (error) {
      console.error('Failed to save token to Python storage:', error);
      // Continue execution even if storage fails
    }

    // Send success message to Telegram
    const telegramMessage = encodeURIComponent(`✅ Successfully connected to Product Hunt as ${user.name} (@${user.username})`);
    await axios.get(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage?chat_id=${userId}&text=${telegramMessage}`);

    // Return success page
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html'
      },
      body: `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authorization Successful</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
                background-color: #f9f9f9;
              }
              .container {
                text-align: center;
                padding: 2rem;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              }
              h1 { color: #4b587c; }
              p { color: #666; }
              .success-icon {
                font-size: 48px;
                margin-bottom: 1rem;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="success-icon">✅</div>
              <h1>Authorization Successful!</h1>
              <p>You have successfully connected your Product Hunt account.</p>
              <p>You can now close this window and return to Telegram.</p>
            </div>
          </body>
        </html>
      `
    };

  } catch (error: any) {
    console.error('Error details:', {
      message: error?.message || 'Unknown error',
      response: error?.response?.data,
      stack: error?.stack
    });

    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: error?.message || 'Internal server error',
        details: error?.response?.data
      })
    };
  }
};

export { handler };
