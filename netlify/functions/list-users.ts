import { Handler } from '@netlify/functions';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function getDatabase() {
  const dbPath = '/tmp/database.sqlite';
  return await open({
    filename: dbPath,
    driver: sqlite3.Database
  });
}

const handler: Handler = async (event) => {
  try {
    const db = await getDatabase();
    const users = await db.all('SELECT * FROM tokens');
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        users: users,
        count: users.length
      }, null, 2)
    };
  } catch (error: any) {
    console.error('Error fetching users:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message || 'Internal server error'
      })
    };
  }
};

export { handler };
