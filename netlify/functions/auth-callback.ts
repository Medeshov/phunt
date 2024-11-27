import { Handler } from '@netlify/functions';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

// Инициализация Supabase клиента
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const handler: Handler = async (event) => {
  // Получаем code и state из query параметров
  const { code, state } = event.queryStringParameters || {};

  if (!code || !state) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required parameters' }),
    };
  }

  try {
    // Получаем telegram_id из state
    const [telegramId] = state.split('_');
    
    // Обмениваем код на токен
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

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Получаем данные пользователя
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

    const userData = userResponse.data.data.viewer.user;

    // Сохраняем данные в Supabase
    await supabase
      .from('users')
      .upsert({
        id: userData.id,
        name: userData.name,
        username: userData.username,
        image: userData.profileImage,
        telegram_id: telegramId,
        ph_access_token: access_token,
        ph_refresh_token: refresh_token,
        ph_token_expires_at: new Date(Date.now() + expires_in * 1000).toISOString()
      });

    // Отправляем уведомление в Telegram
    await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: telegramId,
      text: `✅ Авторизация успешна!\n\nДобро пожаловать, ${userData.name}!\nВаш аккаунт ProductHunt @${userData.username} успешно подключен.`,
      parse_mode: 'Markdown'
    });

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
    console.error('Error in OAuth callback:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
