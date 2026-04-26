-- =============================================================
--  Migração: reduz dimensão dos vetores de 128 → 32
--
--  pgvector não suporta ALTER COLUMN TYPE direto para vector(N).
--  A abordagem segura é recriar as colunas. Os embeddings
--  existentes são descartados (NULL) e serão regenerados
--  pelo próximo ciclo de treinamento.
-- =============================================================

-- vagas
ALTER TABLE vagas DROP COLUMN emb_vaga;
ALTER TABLE vagas ADD  COLUMN emb_vaga vector(32);

-- usuarios
ALTER TABLE usuarios DROP COLUMN emb_usuario;
ALTER TABLE usuarios ADD  COLUMN emb_usuario vector(32);
