import { Handler } from '@netlify/functions';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

// Инициализация Supabase клиента
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const handler: Handler = async (event) => {
  console.log('Received callback request:', {
    queryParams: event.queryStringParameters,
    headers: event.headers
  });

  try {
    // Получаем code и state из query параметров
    const { code, state } = event.queryStringParameters || {};

    console.log('Received parameters:', { code, state });

    if (!code || !state) {
      console.error('Missing required parameters:', { code, state });
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required parameters' }),
      };
    }

    // Проверяем наличие всех необходимых переменных окружения
    const requiredEnvVars = [
      'PRODUCTHUNT_CLIENT_ID',
      'PRODUCTHUNT_CLIENT_SECRET',
      'PRODUCTHUNT_REDIRECT_URI',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'TELEGRAM_BOT_TOKEN'
    ];

    const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
    console.log('Environment variables check:', {
      missing: missingEnvVars,
      redirectUri: process.env.PRODUCTHUNT_REDIRECT_URI
    });
    if (missingEnvVars.length > 0) {
      console.error('Missing environment variables:', missingEnvVars);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Missing environment variables', missing: missingEnvVars }),
      };
    }

    // Получаем telegram_id из state
    const [telegramId, randomState] = state.split('_');
    console.log('Extracted telegram ID:', { telegramId, randomState, state });
    
    // Обмениваем код на токен
    console.log('Exchanging code for token...');
    const tokenResponse = await axios.post(
      'https://api.producthunt.com/v2/oauth/token',
      {
        client_id: process.env.PRODUCTHUNT_CLIENT_ID,
        client_secret: process.env.PRODUCTHUNT_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.PRODUCTHUNT_REDIRECT_URI
      }
    );

    console.log('Token response received:', tokenResponse.data);
    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    if (!access_token) {
      throw new Error('No access token received from Product Hunt');
    }

    // Вычисляем дату истечения токена
    let expiresAt = null;
    if (typeof expires_in === 'number' && !isNaN(expires_in)) {
      expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();
    }

    // Получаем данные пользователя
    console.log('Fetching user data...');
    const userResponse = await axios.post(
      'https://api.producthunt.com/v2/api/graphql',
      {
        query: `
          query {
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
        }
      }
    );

    console.log('User data received');
    const userData = userResponse.data.data.viewer.user;

    // Сохраняем данные в Supabase
    console.log('Saving user data to Supabase...');
    const { error: supabaseError } = await supabase
      .from('users')
      .upsert({
        id: userData.id,
        name: userData.name,
        username: userData.username,
        image: userData.profileImage,
        telegram_id: telegramId,
        ph_access_token: access_token,
        ph_refresh_token: refresh_token,
        ph_token_expires_at: expiresAt
      });

    if (supabaseError) {
      console.error('Supabase error:', supabaseError);
      throw supabaseError;
    }

    // Отправляем уведомление в Telegram
    console.log('Sending Telegram notification...');
    await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: telegramId,
        text: `✅ Авторизация успешна!\n\nДобро пожаловать, ${userData.name}!\nВаш аккаунт ProductHunt @${userData.username} успешно подключен.`,
        parse_mode: 'Markdown'
      }
    );

    console.log('Process completed successfully');
    // Возвращаем успешную страницу
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html',
      },
      body: `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Авторизация успешна</title>
            <style>
              body {
                font-family: -apple-system, system-ui, BlinkMacSystemFont;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                margin: 0;
                background-color: #f5f5f5;
              }
              .container {
                text-align: center;
                padding: 2rem;
                background: white;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                max-width: 500px;
              }
              h1 { color: #4CAF50; }
              .button {
                display: inline-block;
                padding: 10px 20px;
                background-color: #4CAF50;
                color: white;
                text-decoration: none;
                border-radius: 5px;
                margin-top: 20px;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>✅ Авторизация успешна!</h1>
              <p>Вы успешно авторизовались через ProductHunt.</p>
              <p>Можете вернуться в Telegram бот.</p>
              <a href="https://t.me/your_bot_username" class="button">Вернуться в бот</a>
            </div>
          </body>
        </html>
      `
    };
  } catch (error) {
    console.error('Error details:', {
      message: error instanceof Error ? error.message : String(error),
      response: (error as any)?.response?.data,
      stack: error instanceof Error ? error.stack : undefined
    });

    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
        response: (error as any)?.response?.data 
      }),
    };
  }
};