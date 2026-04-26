-- =============================================================
--  job_rec — inicialização do schema
--  Postgres 16 + pgvector
-- =============================================================

-- extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================
--  tipos enumerados
-- =============================================================

CREATE TYPE nivel_senioridade_enum AS ENUM (
    'estagiario',
    'junior',
    'pleno',
    'senior',
    'especialista',
    'lideranca'
);

CREATE TYPE regime_enum AS ENUM (
    'clt',
    'pj',
    'hibrido',
    'remoto',
    'presencial'
);

CREATE TYPE nivel_habilidade_enum AS ENUM (
    'basico',
    'intermediario',
    'avancado',
    'especialista'
);

CREATE TYPE status_candidatura_enum AS ENUM (
    'aplicada',
    'em_analise',
    'entrevista',
    'teste_tecnico',
    'oferta',
    'contratado',
    'rejeitado',
    'desistencia'
);

-- =============================================================
--  tabela: usuarios
-- =============================================================

CREATE TABLE usuarios (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome                VARCHAR(150)    NOT NULL,
    email               VARCHAR(150)    NOT NULL UNIQUE,
    area_atuacao        VARCHAR(100),
    estado              CHAR(2),
    anos_experiencia    SMALLINT        CHECK (anos_experiencia >= 0),
    -- embedding gerado pelo encoder (dim 32)
    emb_usuario         vector(32),
    emb_atualizado_em   TIMESTAMPTZ,
    criado_em           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_estado CHECK (estado ~ '^[A-Z]{2}$')
);

-- =============================================================
--  tabela: habilidades_usuario
-- =============================================================

CREATE TABLE habilidades_usuario (
    id          UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id  UUID                    NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    habilidade  VARCHAR(100)            NOT NULL,
    nivel       nivel_habilidade_enum   NOT NULL DEFAULT 'intermediario',
    criado_em   TIMESTAMPTZ             NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_usuario_habilidade UNIQUE (usuario_id, habilidade)
);

-- =============================================================
--  tabela: vagas
-- =============================================================

CREATE TABLE vagas (
    id                  UUID                        PRIMARY KEY DEFAULT uuid_generate_v4(),
    titulo              VARCHAR(200)                NOT NULL,
    empresa             VARCHAR(150)                NOT NULL,
    estado              CHAR(2),
    regime              regime_enum                 NOT NULL DEFAULT 'clt',
    nivel_senioridade   nivel_senioridade_enum      NOT NULL,
    salario_min         NUMERIC(10, 2)              CHECK (salario_min >= 0),
    salario_max         NUMERIC(10, 2)              CHECK (salario_max >= 0),
    -- embedding gerado pelo encoder (dim 32)
    emb_vaga            vector(32),
    emb_atualizado_em   TIMESTAMPTZ,
    publicada_em        TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
    encerrada_em        TIMESTAMPTZ,

    CONSTRAINT chk_estado_vaga    CHECK (estado ~ '^[A-Z]{2}$'),
    CONSTRAINT chk_salario_range  CHECK (salario_max IS NULL OR salario_max >= salario_min)
);

-- =============================================================
--  tabela: habilidades_vaga
-- =============================================================

CREATE TABLE habilidades_vaga (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    vaga_id     UUID        NOT NULL REFERENCES vagas(id) ON DELETE CASCADE,
    habilidade  VARCHAR(100) NOT NULL,
    obrigatoria BOOLEAN     NOT NULL DEFAULT TRUE,

    CONSTRAINT uq_vaga_habilidade UNIQUE (vaga_id, habilidade)
);

-- =============================================================
--  tabela: historico_contratacoes
-- =============================================================

CREATE TABLE historico_contratacoes (
    id                  UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id          UUID                    NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    cargo               VARCHAR(150)            NOT NULL,
    empresa             VARCHAR(150)            NOT NULL,
    cidade              VARCHAR(100),
    estado              CHAR(2),
    nivel_senioridade   nivel_senioridade_enum,
    ano_contratacao     SMALLINT                NOT NULL CHECK (ano_contratacao > 1970),
    ano_saida           SMALLINT                CHECK (ano_saida IS NULL OR ano_saida >= ano_contratacao),
    criado_em           TIMESTAMPTZ             NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_estado_hist CHECK (estado IS NULL OR estado ~ '^[A-Z]{2}$')
);

-- =============================================================
--  tabela: candidaturas
-- =============================================================

CREATE TABLE candidaturas (
    id              UUID                        PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id      UUID                        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    vaga_id         UUID                        NOT NULL REFERENCES vagas(id)    ON DELETE CASCADE,
    status          status_candidatura_enum     NOT NULL DEFAULT 'aplicada',
    aplicado_em     TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
    atualizado_em   TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_candidatura UNIQUE (usuario_id, vaga_id)
);

-- =============================================================
--  índices relacionais
-- =============================================================

-- habilidades_usuario
CREATE INDEX idx_hab_usuario_usuario_id  ON habilidades_usuario (usuario_id);
CREATE INDEX idx_hab_usuario_habilidade  ON habilidades_usuario (lower(habilidade));

-- habilidades_vaga
CREATE INDEX idx_hab_vaga_vaga_id        ON habilidades_vaga (vaga_id);
CREATE INDEX idx_hab_vaga_habilidade     ON habilidades_vaga (lower(habilidade));
CREATE INDEX idx_hab_vaga_obrigatoria    ON habilidades_vaga (vaga_id) WHERE obrigatoria = TRUE;

-- historico_contratacoes
CREATE INDEX idx_hist_usuario_id         ON historico_contratacoes (usuario_id);
CREATE INDEX idx_hist_nivel              ON historico_contratacoes (nivel_senioridade);

-- vagas
CREATE INDEX idx_vagas_abertas           ON vagas (publicada_em) WHERE encerrada_em IS NULL;
CREATE INDEX idx_vagas_nivel             ON vagas (nivel_senioridade);
CREATE INDEX idx_vagas_regime            ON vagas (regime);
CREATE INDEX idx_vagas_estado            ON vagas (estado);

-- candidaturas
CREATE INDEX idx_cand_usuario_id         ON candidaturas (usuario_id);
CREATE INDEX idx_cand_vaga_id            ON candidaturas (vaga_id);
CREATE INDEX idx_cand_status             ON candidaturas (status);

-- =============================================================
--  índices pgvector — HNSW (busca ANN por cosseno)
--  criados APÓS carga inicial de embeddings via batch
--  deixados comentados aqui; rodar depois do primeiro treino
-- =============================================================

-- CREATE INDEX idx_hnsw_emb_vaga
--     ON vagas USING hnsw (emb_vaga vector_cosine_ops)
--     WITH (m = 16, ef_construction = 64);

-- CREATE INDEX idx_hnsw_emb_usuario
--     ON usuarios USING hnsw (emb_usuario vector_cosine_ops)
--     WITH (m = 16, ef_construction = 64);

-- =============================================================
--  trigger: atualiza candidaturas.atualizado_em automaticamente
-- =============================================================

CREATE OR REPLACE FUNCTION fn_set_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.atualizado_em = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_candidaturas_atualizado_em
BEFORE UPDATE ON candidaturas
FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- =============================================================
--  view auxiliar: vocabulário unificado de habilidades
--  fonte canônica para montar o vocab antes do treino
-- =============================================================

CREATE VIEW vw_vocab_habilidades AS
SELECT lower(trim(habilidade)) AS habilidade,
       COUNT(*)                AS frequencia
FROM (
    SELECT habilidade FROM habilidades_usuario
    UNION ALL
    SELECT habilidade FROM habilidades_vaga
) t
GROUP BY 1
ORDER BY frequencia DESC;

-- =============================================================
--  view auxiliar: candidaturas para label de treino
--  retorna pares (usuario_id, vaga_id) com y = 0 ou 1
-- =============================================================

CREATE VIEW vw_labels_treino AS
SELECT
    c.usuario_id,
    c.vaga_id,
    CASE WHEN c.status = 'contratado' THEN 1 ELSE 0 END AS y
FROM candidaturas c
WHERE c.status IN ('contratado', 'rejeitado');

-- =============================================================
--  trigger: atualiza candidaturas.atualizado_em automaticamente
-- =============================================================

-- =============================================================
--  dados de seed
--
--  A query de treino faz CROSS JOIN entre usuários e vagas,
--  gerando uma linha por par (usuario, vaga). Com 10 usuários
--  e 10 vagas = 100 linhas de treino; 15 contratado (~15%).
--
--  Cobertura de senioridade: todos os 6 níveis do enum estão
--  representados tanto nos usuários quanto nas vagas, garantindo
--  que o one-hot encoding seja treinado em todos os valores.
--
--  Para produção, recomenda-se milhares de registros com
--  balanceamento de classes ou uso de classWeight no model.fit.
-- =============================================================

DO $$
DECLARE
    -- usuários
    id_ana       UUID;
    id_bruno     UUID;
    id_carla     UUID;
    id_diego     UUID;
    id_elena     UUID;
    id_felipe    UUID;
    id_joao      UUID;
    id_marina    UUID;
    id_ricardo   UUID;
    id_isabela   UUID;

    -- vagas
    id_vaga1  UUID;
    id_vaga2  UUID;
    id_vaga3  UUID;
    id_vaga4  UUID;
    id_vaga5  UUID;
    id_vaga6  UUID;
    id_vaga7  UUID;
    id_vaga8  UUID;
    id_vaga9  UUID;
    id_vaga10 UUID;
BEGIN

    -- ── usuarios ──────────────────────────────────────────────
    -- Perfis diversificados cobrindo todos os 6 níveis de senioridade

    INSERT INTO usuarios (nome, email, area_atuacao, estado, anos_experiencia)
    VALUES ('Ana Silva', 'ana@exemplo.com', 'Engenharia de Software', 'SP', 5)
    RETURNING id INTO id_ana;

    INSERT INTO usuarios (nome, email, area_atuacao, estado, anos_experiencia)
    VALUES ('Bruno Costa', 'bruno@exemplo.com', 'Ciencia de Dados', 'RJ', 3)
    RETURNING id INTO id_bruno;

    INSERT INTO usuarios (nome, email, area_atuacao, estado, anos_experiencia)
    VALUES ('Carla Mendes', 'carla@exemplo.com', 'Produto', 'MG', 7)
    RETURNING id INTO id_carla;

    INSERT INTO usuarios (nome, email, area_atuacao, estado, anos_experiencia)
    VALUES ('Diego Santos', 'diego@exemplo.com', 'Desenvolvimento Frontend', 'SP', 1)
    RETURNING id INTO id_diego;

    INSERT INTO usuarios (nome, email, area_atuacao, estado, anos_experiencia)
    VALUES ('Elena Rocha', 'elena@exemplo.com', 'DevOps', 'RS', 4)
    RETURNING id INTO id_elena;

    INSERT INTO usuarios (nome, email, area_atuacao, estado, anos_experiencia)
    VALUES ('Felipe Lima', 'felipe@exemplo.com', 'Engenharia de Software', 'SP', 8)
    RETURNING id INTO id_felipe;

    INSERT INTO usuarios (nome, email, area_atuacao, estado, anos_experiencia)
    VALUES ('Joao Vitor', 'joao@exemplo.com', 'Arquitetura de Software', 'SP', 12)
    RETURNING id INTO id_joao;

    INSERT INTO usuarios (nome, email, area_atuacao, estado, anos_experiencia)
    VALUES ('Marina Torres', 'marina@exemplo.com', 'Ciencia de Dados', 'SP', 0)
    RETURNING id INTO id_marina;

    INSERT INTO usuarios (nome, email, area_atuacao, estado, anos_experiencia)
    VALUES ('Ricardo Alves', 'ricardo@exemplo.com', 'Gestao Tecnica', 'SP', 15)
    RETURNING id INTO id_ricardo;

    INSERT INTO usuarios (nome, email, area_atuacao, estado, anos_experiencia)
    VALUES ('Isabela Cardoso', 'isabela@exemplo.com', 'Machine Learning', 'SP', 2)
    RETURNING id INTO id_isabela;

    -- ── habilidades_usuario ───────────────────────────────────

    -- Ana: senior backend Python
    INSERT INTO habilidades_usuario (usuario_id, habilidade, nivel) VALUES
        (id_ana, 'Python',      'avancado'::nivel_habilidade_enum),
        (id_ana, 'PostgreSQL',  'avancado'::nivel_habilidade_enum),
        (id_ana, 'Docker',      'intermediario'::nivel_habilidade_enum),
        (id_ana, 'SQL',         'avancado'::nivel_habilidade_enum);

    -- Bruno: pleno data science
    INSERT INTO habilidades_usuario (usuario_id, habilidade, nivel) VALUES
        (id_bruno, 'Python',           'avancado'::nivel_habilidade_enum),
        (id_bruno, 'SQL',              'avancado'::nivel_habilidade_enum),
        (id_bruno, 'Machine Learning', 'intermediario'::nivel_habilidade_enum);

    -- Carla: senior produto (skills fora da area de TI — serve para testar mismatch)
    INSERT INTO habilidades_usuario (usuario_id, habilidade, nivel) VALUES
        (id_carla, 'Product Management', 'avancado'::nivel_habilidade_enum),
        (id_carla, 'SQL',                'basico'::nivel_habilidade_enum),
        (id_carla, 'Agile',              'avancado'::nivel_habilidade_enum);

    -- Diego: junior frontend
    INSERT INTO habilidades_usuario (usuario_id, habilidade, nivel) VALUES
        (id_diego, 'JavaScript', 'intermediario'::nivel_habilidade_enum),
        (id_diego, 'React',      'intermediario'::nivel_habilidade_enum),
        (id_diego, 'CSS',        'basico'::nivel_habilidade_enum);

    -- Elena: pleno devops
    INSERT INTO habilidades_usuario (usuario_id, habilidade, nivel) VALUES
        (id_elena, 'Docker',     'avancado'::nivel_habilidade_enum),
        (id_elena, 'Kubernetes', 'avancado'::nivel_habilidade_enum),
        (id_elena, 'AWS',        'intermediario'::nivel_habilidade_enum);

    -- Felipe: senior backend Java
    INSERT INTO habilidades_usuario (usuario_id, habilidade, nivel) VALUES
        (id_felipe, 'Java',       'avancado'::nivel_habilidade_enum),
        (id_felipe, 'Spring',     'avancado'::nivel_habilidade_enum),
        (id_felipe, 'PostgreSQL', 'intermediario'::nivel_habilidade_enum);

    -- Joao: especialista arquitetura
    INSERT INTO habilidades_usuario (usuario_id, habilidade, nivel) VALUES
        (id_joao, 'Java',          'especialista'::nivel_habilidade_enum),
        (id_joao, 'Spring',        'especialista'::nivel_habilidade_enum),
        (id_joao, 'Microservices', 'avancado'::nivel_habilidade_enum),
        (id_joao, 'Kubernetes',    'avancado'::nivel_habilidade_enum),
        (id_joao, 'Docker',        'avancado'::nivel_habilidade_enum);

    -- Marina: estagiaria dados
    INSERT INTO habilidades_usuario (usuario_id, habilidade, nivel) VALUES
        (id_marina, 'Python', 'basico'::nivel_habilidade_enum),
        (id_marina, 'SQL',    'basico'::nivel_habilidade_enum);

    -- Ricardo: lideranca tecnica
    INSERT INTO habilidades_usuario (usuario_id, habilidade, nivel) VALUES
        (id_ricardo, 'Java',          'avancado'::nivel_habilidade_enum),
        (id_ricardo, 'Spring',        'avancado'::nivel_habilidade_enum),
        (id_ricardo, 'Microservices', 'avancado'::nivel_habilidade_enum),
        (id_ricardo, 'Agile',         'especialista'::nivel_habilidade_enum);

    -- Isabela: junior ML
    INSERT INTO habilidades_usuario (usuario_id, habilidade, nivel) VALUES
        (id_isabela, 'Python',          'intermediario'::nivel_habilidade_enum),
        (id_isabela, 'TensorFlow',      'basico'::nivel_habilidade_enum),
        (id_isabela, 'Machine Learning','intermediario'::nivel_habilidade_enum);

    -- ── historico_contratacoes ────────────────────────────────

    INSERT INTO historico_contratacoes
        (usuario_id, cargo, empresa, cidade, estado, nivel_senioridade, ano_contratacao, ano_saida)
    VALUES
        (id_ana,     'Desenvolvedora Backend',  'Startup X',       'Sao Paulo',      'SP', 'pleno'::nivel_senioridade_enum,      2020, 2022),
        (id_ana,     'Engenheira de Software',  'Empresa Y',       'Sao Paulo',      'SP', 'senior'::nivel_senioridade_enum,     2022, NULL),
        (id_bruno,   'Analista de Dados',        'Consultoria Z',   'Rio de Janeiro', 'RJ', 'junior'::nivel_senioridade_enum,     2021, 2023),
        (id_bruno,   'Cientista de Dados',       'DataFirm',        'Rio de Janeiro', 'RJ', 'pleno'::nivel_senioridade_enum,      2023, NULL),
        (id_carla,   'Product Manager',          'FinTech W',       'Belo Horizonte', 'MG', 'senior'::nivel_senioridade_enum,     2019, NULL),
        (id_felipe,  'Desenvolvedor Java',       'BankSoft',        'Sao Paulo',      'SP', 'pleno'::nivel_senioridade_enum,      2018, 2021),
        (id_felipe,  'Engenheiro Backend Senior','TechBank',        'Sao Paulo',      'SP', 'senior'::nivel_senioridade_enum,     2021, NULL),
        (id_joao,    'Arquiteto de Software',    'EnterpriseOne',   'Sao Paulo',      'SP', 'especialista'::nivel_senioridade_enum,2015, NULL),
        (id_ricardo, 'Tech Lead',                'BigCorp',         'Sao Paulo',      'SP', 'lideranca'::nivel_senioridade_enum,  2012, NULL),
        (id_isabela, 'Estagiaria ML',            'AIStartup',       'Sao Paulo',      'SP', 'estagiario'::nivel_senioridade_enum, 2023, 2024);

    -- ── vagas ─────────────────────────────────────────────────
    -- 10 vagas cobrindo todos os 6 níveis de senioridade

    -- vaga1: senior backend Python  →  match esperado: Ana
    INSERT INTO vagas (titulo, empresa, estado, regime, nivel_senioridade, salario_min, salario_max)
    VALUES ('Engenheira Backend Python', 'TechCorp', 'SP',
            'hibrido'::regime_enum, 'senior'::nivel_senioridade_enum, 12000, 18000)
    RETURNING id INTO id_vaga1;

    -- vaga2: pleno data science  →  match esperado: Bruno
    INSERT INTO vagas (titulo, empresa, estado, regime, nivel_senioridade, salario_min, salario_max)
    VALUES ('Cientista de Dados Pleno', 'DataLab', 'RJ',
            'remoto'::regime_enum, 'pleno'::nivel_senioridade_enum, 8000, 14000)
    RETURNING id INTO id_vaga2;

    -- vaga3: junior frontend  →  match esperado: Diego
    INSERT INTO vagas (titulo, empresa, estado, regime, nivel_senioridade, salario_min, salario_max)
    VALUES ('Desenvolvedor Frontend Junior', 'WebAgency', 'SP',
            'presencial'::regime_enum, 'junior'::nivel_senioridade_enum, 3500, 5500)
    RETURNING id INTO id_vaga3;

    -- vaga4: pleno devops  →  match esperado: Elena
    INSERT INTO vagas (titulo, empresa, estado, regime, nivel_senioridade, salario_min, salario_max)
    VALUES ('DevOps Engineer Pleno', 'CloudOps', 'SP',
            'hibrido'::regime_enum, 'pleno'::nivel_senioridade_enum, 9000, 13000)
    RETURNING id INTO id_vaga4;

    -- vaga5: senior backend Java  →  match esperado: Felipe
    INSERT INTO vagas (titulo, empresa, estado, regime, nivel_senioridade, salario_min, salario_max)
    VALUES ('Engenheiro Backend Java Senior', 'BankTech', 'SP',
            'hibrido'::regime_enum, 'senior'::nivel_senioridade_enum, 14000, 20000)
    RETURNING id INTO id_vaga5;

    -- vaga6: pleno frontend React  →  match esperado: nenhum usuário tem esse perfil exato
    INSERT INTO vagas (titulo, empresa, estado, regime, nivel_senioridade, salario_min, salario_max)
    VALUES ('Desenvolvedor Frontend React Pleno', 'UXCorp', 'RJ',
            'remoto'::regime_enum, 'pleno'::nivel_senioridade_enum, 7000, 11000)
    RETURNING id INTO id_vaga6;

    -- vaga7: estagiario dados  →  match esperado: Marina
    INSERT INTO vagas (titulo, empresa, estado, regime, nivel_senioridade, salario_min, salario_max)
    VALUES ('Estagio em Ciencia de Dados', 'StartupAI', 'SP',
            'presencial'::regime_enum, 'estagiario'::nivel_senioridade_enum, 1500, 2500)
    RETURNING id INTO id_vaga7;

    -- vaga8: especialista arquitetura  →  match esperado: Joao
    INSERT INTO vagas (titulo, empresa, estado, regime, nivel_senioridade, salario_min, salario_max)
    VALUES ('Arquiteto de Software', 'EnterpriseCo', 'SP',
            'hibrido'::regime_enum, 'especialista'::nivel_senioridade_enum, 20000, 30000)
    RETURNING id INTO id_vaga8;

    -- vaga9: lideranca tech lead  →  match esperado: Ricardo
    INSERT INTO vagas (titulo, empresa, estado, regime, nivel_senioridade, salario_min, salario_max)
    VALUES ('Tech Lead Backend', 'BigCorp', 'SP',
            'hibrido'::regime_enum, 'lideranca'::nivel_senioridade_enum, 22000, 35000)
    RETURNING id INTO id_vaga9;

    -- vaga10: junior ML  →  match esperado: Isabela
    INSERT INTO vagas (titulo, empresa, estado, regime, nivel_senioridade, salario_min, salario_max)
    VALUES ('ML Engineer Junior', 'AILab', 'SP',
            'remoto'::regime_enum, 'junior'::nivel_senioridade_enum, 4500, 7000)
    RETURNING id INTO id_vaga10;

    -- ── habilidades_vaga ──────────────────────────────────────

    INSERT INTO habilidades_vaga (vaga_id, habilidade, obrigatoria) VALUES
        -- vaga1: backend Python senior
        (id_vaga1, 'Python',      TRUE),
        (id_vaga1, 'PostgreSQL',  TRUE),
        (id_vaga1, 'Docker',      TRUE),
        (id_vaga1, 'SQL',         FALSE),

        -- vaga2: data science pleno
        (id_vaga2, 'Python',           TRUE),
        (id_vaga2, 'SQL',              TRUE),
        (id_vaga2, 'Machine Learning', TRUE),
        (id_vaga2, 'Spark',            FALSE),

        -- vaga3: frontend junior
        (id_vaga3, 'JavaScript', TRUE),
        (id_vaga3, 'React',      TRUE),
        (id_vaga3, 'CSS',        TRUE),
        (id_vaga3, 'TypeScript', FALSE),

        -- vaga4: devops pleno
        (id_vaga4, 'Docker',     TRUE),
        (id_vaga4, 'Kubernetes', TRUE),
        (id_vaga4, 'AWS',        TRUE),
        (id_vaga4, 'Terraform',  FALSE),

        -- vaga5: backend Java senior
        (id_vaga5, 'Java',       TRUE),
        (id_vaga5, 'Spring',     TRUE),
        (id_vaga5, 'PostgreSQL', TRUE),

        -- vaga6: frontend React pleno
        (id_vaga6, 'React',      TRUE),
        (id_vaga6, 'TypeScript', TRUE),
        (id_vaga6, 'CSS',        TRUE),
        (id_vaga6, 'JavaScript', FALSE),

        -- vaga7: estagio dados
        (id_vaga7, 'Python', TRUE),
        (id_vaga7, 'SQL',    TRUE),

        -- vaga8: arquiteto especialista
        (id_vaga8, 'Java',          TRUE),
        (id_vaga8, 'Spring',        TRUE),
        (id_vaga8, 'Microservices', TRUE),
        (id_vaga8, 'Kubernetes',    TRUE),

        -- vaga9: tech lead lideranca
        (id_vaga9, 'Java',          TRUE),
        (id_vaga9, 'Spring',        TRUE),
        (id_vaga9, 'Microservices', TRUE),
        (id_vaga9, 'Agile',         TRUE),

        -- vaga10: ML junior
        (id_vaga10, 'Python',          TRUE),
        (id_vaga10, 'TensorFlow',      TRUE),
        (id_vaga10, 'Machine Learning',TRUE);

    -- ── candidaturas ─────────────────────────────────────────
    --
    -- A query de treino usa CROSS JOIN (todos os pares usuario×vaga),
    -- portanto omitir uma candidatura equivale a y=0 para aquele par.
    -- Registramos aqui apenas os pares com resultado definitivo
    -- (contratado ou rejeitado) para sinalizar explicitamente o label.
    --
    -- Pares contratado: skills + senioridade alinhados (y=1)
    -- Pares rejeitado:  mismatch explícito de skills ou senioridade (y=0)
    -- Demais pares:     y=0 implícito via LEFT JOIN na query de treino
    --
    -- Resultado: 100 linhas de treino (10×10), ~15 positivas (~15%)

    INSERT INTO candidaturas (usuario_id, vaga_id, status) VALUES

        -- contratados: skill + senioridade alinhados
        (id_ana,     id_vaga1,  'contratado'::status_candidatura_enum),  -- Python+PG+Docker senior → vaga senior Python
        (id_bruno,   id_vaga2,  'contratado'::status_candidatura_enum),  -- Python+SQL+ML pleno   → vaga pleno DS
        (id_diego,   id_vaga3,  'contratado'::status_candidatura_enum),  -- JS+React+CSS junior   → vaga junior Frontend
        (id_elena,   id_vaga4,  'contratado'::status_candidatura_enum),  -- Docker+K8s+AWS pleno  → vaga pleno DevOps
        (id_felipe,  id_vaga5,  'contratado'::status_candidatura_enum),  -- Java+Spring+PG senior → vaga senior Java
        (id_joao,    id_vaga8,  'contratado'::status_candidatura_enum),  -- Java+Spring+MS+K8s esp→ vaga especialista
        (id_marina,  id_vaga7,  'contratado'::status_candidatura_enum),  -- Python+SQL estag      → vaga estagio dados
        (id_ricardo, id_vaga9,  'contratado'::status_candidatura_enum),  -- Java+Spring+MS+Agile  → vaga lideranca
        (id_isabela, id_vaga10, 'contratado'::status_candidatura_enum),  -- Python+TF+ML junior   → vaga junior ML
        -- Joao (especialista) aceita vaga senior Java por fit de skills — empresa preferiu nao contratar para especialista
        (id_joao,    id_vaga5,  'contratado'::status_candidatura_enum),  -- Java+Spring esp aceito para senior
        -- Ana (senior Python) aceita vaga pleno DS por sobreposição de skills Python+SQL
        (id_ana,     id_vaga2,  'contratado'::status_candidatura_enum),

        -- rejeitados: mismatch explícito de skills ou senioridade
        (id_carla,   id_vaga1,  'rejeitado'::status_candidatura_enum),   -- PM sem skills tecnicas → vaga backend
        (id_carla,   id_vaga5,  'rejeitado'::status_candidatura_enum),   -- PM sem skills tecnicas → vaga Java
        (id_diego,   id_vaga5,  'rejeitado'::status_candidatura_enum),   -- junior JS → vaga senior Java
        (id_marina,  id_vaga2,  'rejeitado'::status_candidatura_enum),   -- estagiaria → vaga pleno DS
        (id_felipe,  id_vaga8,  'rejeitado'::status_candidatura_enum),   -- senior sem Microservices → vaga especialista
        (id_isabela, id_vaga1,  'rejeitado'::status_candidatura_enum),   -- junior ML → vaga senior backend
        (id_bruno,   id_vaga4,  'rejeitado'::status_candidatura_enum),   -- DS sem skills devops → vaga devops
        (id_elena,   id_vaga5,  'rejeitado'::status_candidatura_enum),   -- devops sem Java → vaga Java
        (id_ana,     id_vaga9,  'rejeitado'::status_candidatura_enum),   -- senior Python → vaga lideranca Java
        (id_ricardo, id_vaga7,  'rejeitado'::status_candidatura_enum);   -- lideranca → vaga estagio (overqualified)

END $$;
