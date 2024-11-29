-- Создаем enum для типов заданий
CREATE TYPE task_type AS ENUM ('upvote', 'review', 'comment');

-- Создаем enum для статусов заданий
CREATE TYPE task_status AS ENUM ('active', 'completed', 'expired', 'cancelled');

-- Создаем таблицу заданий
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id TEXT NOT NULL REFERENCES users(id),
    product_url TEXT NOT NULL,
    product_name TEXT NOT NULL,
    task_type task_type NOT NULL,
    points INTEGER NOT NULL,
    description TEXT,
    requirements TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status task_status DEFAULT 'active',
    max_completions INTEGER DEFAULT 1,
    current_completions INTEGER DEFAULT 0,
    
    CONSTRAINT valid_points CHECK (points > 0),
    CONSTRAINT valid_max_completions CHECK (max_completions > 0),
    CONSTRAINT valid_current_completions CHECK (current_completions >= 0)
);

-- Создаем таблицу выполнения заданий
CREATE TABLE IF NOT EXISTS task_completions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES tasks(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    proof_url TEXT,
    comment TEXT,
    status task_status DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    verified_at TIMESTAMP WITH TIME ZONE,
    points_awarded INTEGER,
    
    CONSTRAINT unique_task_completion UNIQUE(task_id, user_id)
);

-- Создаем индексы для оптимизации запросов
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(creator_id);
CREATE INDEX IF NOT EXISTS idx_task_completions_user ON task_completions(user_id);
CREATE INDEX IF NOT EXISTS idx_task_completions_task ON task_completions(task_id);
