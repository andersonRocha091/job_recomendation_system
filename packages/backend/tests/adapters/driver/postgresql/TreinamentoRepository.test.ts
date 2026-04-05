import { Pool, QueryResult } from 'pg';
import { TreinamentoRepository } from '@adapters/driver/postgresql/TreinamentoRepository';
import { RawTrainingRow } from '@adapters/driver/postgresql/TrainingRowMapper';

const makePool = (queryResult: Partial<QueryResult> | Error): jest.Mocked<Pick<Pool, 'query'>> => {
    const query = queryResult instanceof Error
        ? jest.fn().mockRejectedValue(queryResult)
        : jest.fn().mockResolvedValue(queryResult);
    return { query } as unknown as jest.Mocked<Pick<Pool, 'query'>>;
};

const makeRawRow = (overrides: Partial<RawTrainingRow> = {}): RawTrainingRow => ({
    anos_experiencia: 3,
    habilidades_usuario: ['Node.js', 'TypeScript'],
    nivel_senioridade: 'pleno',
    habilidades_vagas: ['Node.js', 'AWS'],
    contratado: 0,
    ...overrides,
});

describe('TreinamentoRepository', () => {
    describe('getRawTrainingData', () => {
        it('mapeia linha do banco para o modelo de domínio (candidato contratado)', async () => {
            const pool = makePool({ rows: [makeRawRow({ contratado: 1 })] });
            const repo = new TreinamentoRepository(pool as unknown as Pool);

            const [result] = await repo.getRawTrainingData();

            expect(result).toEqual({
                anosExperiencia: 3,
                skillsUsuario: ['Node.js', 'TypeScript'],
                nivelSenioridade: 'pleno',
                skillsVaga: ['Node.js', 'AWS'],
                contratado: 1,
            });
        });

        it('mapeia linha do banco para o modelo de domínio (candidato não contratado)', async () => {
            const pool = makePool({ rows: [makeRawRow({ contratado: 0 })] });
            const repo = new TreinamentoRepository(pool as unknown as Pool);

            const [result] = await repo.getRawTrainingData();

            expect(result.contratado).toBe(0);
        });

        it('retorna múltiplas combinações usuário×vaga (produto cruzado real)', async () => {
            const rawRows: RawTrainingRow[] = [
                makeRawRow({ anos_experiencia: 3, nivel_senioridade: 'pleno',  contratado: 1 }),
                makeRawRow({ anos_experiencia: 3, nivel_senioridade: 'senior', contratado: 0 }),
                makeRawRow({ anos_experiencia: 7, nivel_senioridade: 'pleno',  contratado: 0 }),
                makeRawRow({ anos_experiencia: 7, nivel_senioridade: 'senior', contratado: 1 }),
            ];
            const pool = makePool({ rows: rawRows });
            const repo = new TreinamentoRepository(pool as unknown as Pool);

            const result = await repo.getRawTrainingData();

            expect(result).toHaveLength(4);
            expect(result.filter(r => r.contratado === 1)).toHaveLength(2);
            expect(result.filter(r => r.contratado === 0)).toHaveLength(2);
        });

        it('retorna array vazio quando não há dados de treinamento', async () => {
            const pool = makePool({ rows: [] });
            const repo = new TreinamentoRepository(pool as unknown as Pool);

            const result = await repo.getRawTrainingData();

            expect(result).toEqual([]);
        });

        it('propaga erro de conexão com o banco de dados', async () => {
            const pool = makePool(new Error('Connection refused: could not connect to server'));
            const repo = new TreinamentoRepository(pool as unknown as Pool);

            await expect(repo.getRawTrainingData()).rejects.toThrow(
                'Connection refused: could not connect to server'
            );
        });

        it('propaga erro de timeout na query', async () => {
            const timeoutError = new Error('Query read timeout');
            (timeoutError as any).code = '57014'; // PostgreSQL query_canceled
            const pool = makePool(timeoutError);
            const repo = new TreinamentoRepository(pool as unknown as Pool);

            await expect(repo.getRawTrainingData()).rejects.toThrow('Query read timeout');
        });

        it('executa a query SQL com os JOINs e GROUP BY corretos', async () => {
            const pool = makePool({ rows: [] });
            const repo = new TreinamentoRepository(pool as unknown as Pool);

            await repo.getRawTrainingData();

            expect(pool.query).toHaveBeenCalledTimes(1);
            const [sql] = (pool.query as jest.Mock).mock.calls[0];
            expect(sql).toMatch(/FROM\s+usuarios/i);
            expect(sql).toMatch(/JOIN\s+habilidades_usuario/i);
            expect(sql).toMatch(/CROSS\s+JOIN\s+vagas/i);
            expect(sql).toMatch(/JOIN\s+habilidades_vaga/i);
            expect(sql).toMatch(/LEFT\s+JOIN\s+candidaturas/i);
            expect(sql).toMatch(/GROUP\s+BY/i);
            expect(sql).toMatch(/array_agg/i);
        });
    });
});
