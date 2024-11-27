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

    // Проверяем, что telegram_id - это число
    if (!telegramId || isNaN(Number(telegramId))) {
      console.error('Invalid telegram_id in state:', { telegramId, state });
      throw new Error('Invalid telegram_id in state parameter');
    }

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
        text: `✅ Авторизация успешна!\n\nДобро пожаловать, ${userData.name}!\nВаш аккаунт ProductHunt успешно подключен.\nUsername: ${userData.username}`,
        parse_mode: 'HTML'
      }
    );

    console.log('Process completed successfully');
    // Возвращаем успешную страницу
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
      body: `
        <!DOCTYPE html>
        <html lang="ru">
          <head>
            <meta charset="UTF-8">
            <title>Авторизация успешна</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body {
                font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                margin: 0;
                background-color: #f5f5f5;
                color: #333;
              }
              .container {
                text-align: center;
                background: white;
                padding: 2rem;
                border-radius: 12px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                max-width: 90%;
                width: 400px;
              }
              h1 {
                color: #da552f;
                margin-bottom: 1rem;
              }
              p {
                margin: 1rem 0;
                line-height: 1.5;
              }
              .success-icon {
                font-size: 48px;
                margin-bottom: 1rem;
              }
              .button {
                display: inline-block;
                background-color: #da552f;
                color: white;
                padding: 12px 24px;
                border-radius: 6px;
                text-decoration: none;
                margin-top: 1rem;
                font-weight: 500;
                transition: background-color 0.2s;
              }
              .button:hover {
                background-color: #b54424;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="success-icon">✅</div>
              <h1>Авторизация успешна!</h1>
              <p>Вы успешно авторизовались через ProductHunt.</p>
              <p>Можете вернуться в Telegram бот.</p>
              <a href="https://t.me/producthuntpromotion_bot" class="button">Вернуться в бот</a>
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
