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
    -- embedding gerado pelo encoder_usuario (dim 128)
    emb_usuario         vector(128),
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
    -- embedding gerado pelo encoder_vaga (dim 128)
    emb_vaga            vector(128),
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
--  dados de seed — registros de teste para validar o schema
--  usa DO block para garantir visibilidade dos IDs entre inserts
-- =============================================================

DO $$
DECLARE
    id_ana   UUID;
    id_bruno UUID;
    id_carla UUID;
    id_vaga1 UUID;
    id_vaga2 UUID;
    id_vaga3 UUID;
BEGIN

    -- ── usuarios ──────────────────────────────────────────────
    INSERT INTO usuarios (nome, email, area_atuacao, estado, anos_experiencia)
    VALUES ('Ana Silva', 'ana@exemplo.com', 'Engenharia de Software', 'SP', 5)
    RETURNING id INTO id_ana;

    INSERT INTO usuarios (nome, email, area_atuacao, estado, anos_experiencia)
    VALUES ('Bruno Costa', 'bruno@exemplo.com', 'Ciencia de Dados', 'RJ', 3)
    RETURNING id INTO id_bruno;

    INSERT INTO usuarios (nome, email, area_atuacao, estado, anos_experiencia)
    VALUES ('Carla Mendes', 'carla@exemplo.com', 'Produto', 'MG', 7)
    RETURNING id INTO id_carla;

    -- ── habilidades_usuario ───────────────────────────────────
    INSERT INTO habilidades_usuario (usuario_id, habilidade, nivel) VALUES
        (id_ana,   'Python',         'avancado'::nivel_habilidade_enum),
        (id_ana,   'PostgreSQL',     'intermediario'::nivel_habilidade_enum),
        (id_ana,   'Docker',         'intermediario'::nivel_habilidade_enum),
        (id_bruno, 'Python',         'avancado'::nivel_habilidade_enum),
        (id_bruno, 'SQL',            'avancado'::nivel_habilidade_enum),
        (id_bruno, 'Machine Learning', 'intermediario'::nivel_habilidade_enum),
        (id_carla, 'Product Management', 'avancado'::nivel_habilidade_enum),
        (id_carla, 'SQL',            'basico'::nivel_habilidade_enum);

    -- ── historico_contratacoes ────────────────────────────────
    INSERT INTO historico_contratacoes
        (usuario_id, cargo, empresa, cidade, estado, nivel_senioridade, ano_contratacao, ano_saida)
    VALUES
        (id_ana,   'Desenvolvedora Backend',  'Startup X',     'Sao Paulo',      'SP', 'pleno'::nivel_senioridade_enum,  2020, 2022),
        (id_ana,   'Engenheira de Software',  'Empresa Y',     'Sao Paulo',      'SP', 'senior'::nivel_senioridade_enum, 2022, NULL),
        (id_bruno, 'Analista de Dados',       'Consultoria Z', 'Rio de Janeiro', 'RJ', 'junior'::nivel_senioridade_enum, 2021, 2023),
        (id_bruno, 'Cientista de Dados Jr',   'DataFirm',      'Rio de Janeiro', 'RJ', 'pleno'::nivel_senioridade_enum,  2023, NULL),
        (id_carla, 'Product Manager',         'FinTech W',     'Belo Horizonte', 'MG', 'senior'::nivel_senioridade_enum, 2019, NULL);

    -- ── vagas ─────────────────────────────────────────────────
    INSERT INTO vagas (titulo, empresa, estado, regime, nivel_senioridade, salario_min, salario_max)
    VALUES ('Engenheira Backend Python', 'TechCorp', 'SP',
            'hibrido'::regime_enum, 'senior'::nivel_senioridade_enum, 12000, 18000)
    RETURNING id INTO id_vaga1;

    INSERT INTO vagas (titulo, empresa, estado, regime, nivel_senioridade, salario_min, salario_max)
    VALUES ('Cientista de Dados', 'DataLab', 'RJ',
            'remoto'::regime_enum, 'pleno'::nivel_senioridade_enum, 8000, 14000)
    RETURNING id INTO id_vaga2;

    INSERT INTO vagas (titulo, empresa, estado, regime, nivel_senioridade, salario_min, salario_max)
    VALUES ('Desenvolvedor Fullstack', 'Agencia Nova', 'MG',
            'presencial'::regime_enum, 'junior'::nivel_senioridade_enum, 5000, 8000)
    RETURNING id INTO id_vaga3;

    -- ── habilidades_vaga ──────────────────────────────────────
    INSERT INTO habilidades_vaga (vaga_id, habilidade, obrigatoria) VALUES
        (id_vaga1, 'Python',           TRUE),
        (id_vaga1, 'PostgreSQL',       TRUE),
        (id_vaga1, 'Docker',           FALSE),
        (id_vaga1, 'Kubernetes',       FALSE),
        (id_vaga2, 'Python',           TRUE),
        (id_vaga2, 'SQL',              TRUE),
        (id_vaga2, 'Machine Learning', FALSE),
        (id_vaga2, 'Spark',            FALSE),
        (id_vaga3, 'JavaScript',       TRUE),
        (id_vaga3, 'React',            TRUE),
        (id_vaga3, 'SQL',              FALSE);

    -- ── candidaturas (base para labels de treino) ─────────────
    INSERT INTO candidaturas (usuario_id, vaga_id, status) VALUES
        (id_ana,   id_vaga1, 'contratado'::status_candidatura_enum),
        (id_ana,   id_vaga2, 'rejeitado'::status_candidatura_enum),
        (id_bruno, id_vaga2, 'contratado'::status_candidatura_enum),
        (id_bruno, id_vaga1, 'rejeitado'::status_candidatura_enum),
        (id_carla, id_vaga3, 'em_analise'::status_candidatura_enum);

END $$;