import { Pool, QueryResult } from 'pg';
import { VagaRepositoryImpl } from '@adapters/driver/postgresql/VagaRepositoryImpl';
import { Vaga } from '@core/domain/Vaga';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePool = (queryResult: Partial<QueryResult> | Error): jest.Mocked<Pick<Pool, 'query'>> => {
    const query = queryResult instanceof Error
        ? jest.fn().mockRejectedValue(queryResult)
        : jest.fn().mockResolvedValue(queryResult);
    return { query } as unknown as jest.Mocked<Pick<Pool, 'query'>>;
};

const makeVaga = (overrides: Partial<Vaga> = {}): Vaga => ({
    id: 'vaga-001',
    titulo: 'Desenvolvedor Backend',
    empresa: 'TechCorp',
    estado: 'SP',
    regime: 'CLT',
    nivelSenioridade: 'pleno',
    salarioMin: 8000,
    salarioMax: 12000,
    publicadaEm: new Date('2026-01-10T00:00:00.000Z'),
    encerradaEm: null,
    habilidades: ['Node.js', 'TypeScript', 'PostgreSQL'],
    ...overrides,
});

const getSql = (pool: jest.Mocked<Pick<Pool, 'query'>>, callIndex = 0): string =>
    (pool.query as jest.Mock).mock.calls[callIndex][0] as string;

const getParams = (pool: jest.Mocked<Pick<Pool, 'query'>>, callIndex = 0): any[] =>
    (pool.query as jest.Mock).mock.calls[callIndex][1] as any[];

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('VagaRepositoryImpl', () => {

    // -----------------------------------------------------------------------
    describe('findAll()', () => {
        it('retorna lista de vagas mapeada para o modelo de domínio', async () => {
            const vaga = makeVaga();
            const pool = makePool({ rows: [vaga] });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            const result = await repo.findAll();

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual(vaga);
        });

        it('mapeia corretamente os campos snake_case do banco para camelCase do domínio', async () => {
            // O pg driver recebe o alias "AS nivelSenioridade" etc. e retorna
            // a chave exatamente como está no alias — testamos que o resultado
            // tem as propriedades camelCase esperadas pela interface Vaga
            const vaga = makeVaga({
                nivelSenioridade: 'senior',
                salarioMin: 15000,
                salarioMax: 20000,
                publicadaEm: new Date('2026-03-01T00:00:00.000Z'),
                encerradaEm: null,
            });
            const pool = makePool({ rows: [vaga] });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            const [result] = await repo.findAll();

            expect(result.nivelSenioridade).toBe('senior');
            expect(result.salarioMin).toBe(15000);
            expect(result.salarioMax).toBe(20000);
            expect(result.publicadaEm).toEqual(new Date('2026-03-01T00:00:00.000Z'));
            expect(result.encerradaEm).toBeNull();
        });

        it('retorna múltiplas vagas preservando a ordem retornada pelo banco', async () => {
            const vagas = [
                makeVaga({ id: 'vaga-003', titulo: 'Mais recente', publicadaEm: new Date('2026-03-01') }),
                makeVaga({ id: 'vaga-001', titulo: 'Intermediária', publicadaEm: new Date('2026-02-01') }),
                makeVaga({ id: 'vaga-002', titulo: 'Mais antiga',  publicadaEm: new Date('2026-01-01') }),
            ];
            const pool = makePool({ rows: vagas });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            const result = await repo.findAll();

            expect(result).toHaveLength(3);
            expect(result.map(v => v.id)).toEqual(['vaga-003', 'vaga-001', 'vaga-002']);
        });

        it('retorna array vazio quando não há vagas abertas', async () => {
            const pool = makePool({ rows: [] });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            const result = await repo.findAll();

            expect(result).toEqual([]);
        });

        it('aceita vagas com campos opcionais nulos (estado, salários)', async () => {
            const vaga = makeVaga({ estado: null, salarioMin: null, salarioMax: null });
            const pool = makePool({ rows: [vaga] });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            const [result] = await repo.findAll();

            expect(result.estado).toBeNull();
            expect(result.salarioMin).toBeNull();
            expect(result.salarioMax).toBeNull();
        });

        it('filtra somente vagas abertas: SQL deve conter WHERE encerrada_em IS NULL', async () => {
            const pool = makePool({ rows: [] });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            await repo.findAll();

            expect(getSql(pool)).toMatch(/WHERE\s+v\.encerrada_em\s+IS\s+NULL/i);
        });

        it('ordena por publicada_em DESC: SQL deve conter ORDER BY publicada_em DESC', async () => {
            const pool = makePool({ rows: [] });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            await repo.findAll();

            expect(getSql(pool)).toMatch(/ORDER\s+BY\s+v\.publicada_em\s+DESC/i);
        });

        it('faz LEFT JOIN com habilidades_vaga para popular o campo habilidades', async () => {
            const pool = makePool({ rows: [] });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            await repo.findAll();

            const sql = getSql(pool);
            expect(sql).toMatch(/LEFT\s+JOIN\s+habilidades_vaga\s+hv\s+ON\s+hv\.vaga_id\s*=\s*v\.id/i);
        });

        it('usa array_agg para agregar as habilidades da vaga', async () => {
            const pool = makePool({ rows: [] });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            await repo.findAll();

            expect(getSql(pool)).toMatch(/array_agg/i);
        });

        it('usa GROUP BY para evitar duplicação de vagas com múltiplas habilidades', async () => {
            const pool = makePool({ rows: [] });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            await repo.findAll();

            expect(getSql(pool)).toMatch(/GROUP\s+BY\s+v\.id/i);
        });

        it('retorna habilidades populadas a partir do JOIN com habilidades_vaga', async () => {
            const vaga = makeVaga({ habilidades: ['Node.js', 'TypeScript', 'AWS'] });
            const pool = makePool({ rows: [vaga] });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            const [result] = await repo.findAll();

            expect(result.habilidades).toEqual(['Node.js', 'TypeScript', 'AWS']);
        });

        it('retorna array vazio de habilidades para vagas sem skills cadastradas (COALESCE)', async () => {
            const vaga = makeVaga({ habilidades: [] });
            const pool = makePool({ rows: [vaga] });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            const [result] = await repo.findAll();

            expect(result.habilidades).toEqual([]);
        });

        it('propaga erro de conexão com o banco de dados', async () => {
            const pool = makePool(new Error('Connection refused'));
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            await expect(repo.findAll()).rejects.toThrow('Connection refused');
        });

        it('propaga erro de timeout na query', async () => {
            const timeoutError = new Error('Query read timeout');
            (timeoutError as any).code = '57014';
            const pool = makePool(timeoutError);
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            await expect(repo.findAll()).rejects.toThrow('Query read timeout');
        });
    });

    // -----------------------------------------------------------------------
    describe('findById()', () => {
        it('retorna a vaga correspondente ao id fornecido', async () => {
            const vaga = makeVaga({ id: 'vaga-42' });
            const pool = makePool({ rows: [vaga] });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            const result = await repo.findById('vaga-42');

            expect(result).toEqual(vaga);
        });

        it('retorna null quando nenhuma vaga é encontrada para o id', async () => {
            const pool = makePool({ rows: [] });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            const result = await repo.findById('id-inexistente');

            expect(result).toBeNull();
        });

        it('passa o id como parâmetro posicional $1 para evitar SQL injection', async () => {
            const pool = makePool({ rows: [] });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            await repo.findById('vaga-99');

            expect(getSql(pool)).toMatch(/WHERE\s+v\.id\s*=\s*\$1/i);
            expect(getParams(pool)).toEqual(['vaga-99']);
        });

        it('faz LEFT JOIN com habilidades_vaga para popular habilidades da vaga encontrada', async () => {
            const pool = makePool({ rows: [] });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            await repo.findById('vaga-001');

            expect(getSql(pool)).toMatch(/LEFT\s+JOIN\s+habilidades_vaga\s+hv\s+ON\s+hv\.vaga_id\s*=\s*v\.id/i);
        });

        it('retorna vaga com habilidades populadas quando encontrada', async () => {
            const vaga = makeVaga({ id: 'vaga-42', habilidades: ['Python', 'FastAPI'] });
            const pool = makePool({ rows: [vaga] });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            const result = await repo.findById('vaga-42');

            expect(result?.habilidades).toEqual(['Python', 'FastAPI']);
        });

        it('retorna apenas o primeiro resultado do banco (rows[0])', async () => {
            // O banco deve garantir unicidade do id, mas o repo usa rows[0] por segurança
            const vaga = makeVaga({ id: 'vaga-1' });
            const pool = makePool({ rows: [vaga, makeVaga({ id: 'vaga-2' })] });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            const result = await repo.findById('vaga-1');

            expect(result).toEqual(vaga);
        });

        it('retorna vaga com encerradaEm preenchida (vaga encerrada — raro mas possível via id)', async () => {
            const vagaEncerrada = makeVaga({
                encerradaEm: new Date('2026-02-28T00:00:00.000Z'),
            });
            const pool = makePool({ rows: [vagaEncerrada] });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            const result = await repo.findById('vaga-encerrada');

            expect(result?.encerradaEm).toEqual(new Date('2026-02-28T00:00:00.000Z'));
        });

        it('propaga erro de conexão com o banco de dados', async () => {
            const pool = makePool(new Error('ECONNREFUSED'));
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            await expect(repo.findById('qualquer-id')).rejects.toThrow('ECONNREFUSED');
        });
    });

    // -----------------------------------------------------------------------
    describe('updateEmbeddings()', () => {
        it('executa o UPDATE sem erros e retorna void', async () => {
            const pool = makePool({ rows: [], rowCount: 1 });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            const result = await repo.updateEmbeddings('vaga-001', [0.1, 0.5, 0.9]);

            expect(result).toBeUndefined();
        });

        it('converte number[] para o literal pgvector "[x,y,z]" antes de passar ao banco', async () => {
            // O driver pg serializa number[] como '{x,y,z}' (array PostgreSQL),
            // incompatível com o tipo vector. A conversão para '[x,y,z]' é obrigatória.
            const pool = makePool({ rows: [], rowCount: 1 });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            await repo.updateEmbeddings('vaga-007', [0.12, 0.45, 0.78, 0.33]);

            expect(getParams(pool)[0]).toBe('[0.12,0.45,0.78,0.33]');
            expect(getParams(pool)[1]).toBe('vaga-007');
        });

        it('literal pgvector usa colchetes, não chaves (formato array PostgreSQL seria rejeitado)', async () => {
            const pool = makePool({ rows: [], rowCount: 1 });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            await repo.updateEmbeddings('vaga-001', [0.1, 0.2, 0.3]);

            const vectorParam = getParams(pool)[0] as string;
            expect(vectorParam).toMatch(/^\[.*\]$/);   // começa com [ e termina com ]
            expect(vectorParam).not.toMatch(/^\{.*\}$/); // não usa {} de array pg
        });

        it('SQL atualiza a coluna emb_vaga na tabela vagas com filtro por id', async () => {
            const pool = makePool({ rows: [], rowCount: 1 });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            await repo.updateEmbeddings('vaga-001', [0.1]);

            const sql = getSql(pool);
            expect(sql).toMatch(/UPDATE\s+vagas/i);
            expect(sql).toMatch(/SET\s+emb_vaga\s*=\s*\$1/i);
            expect(sql).toMatch(/WHERE\s+id\s*=\s*\$2/i);
        });

        it('vetor vazio gera literal "[]" — compatível com pgvector', async () => {
            const pool = makePool({ rows: [], rowCount: 0 });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            await expect(repo.updateEmbeddings('vaga-001', [])).resolves.toBeUndefined();
            expect(getParams(pool)[0]).toBe('[]');
        });

        it('aceita vetor de alta dimensionalidade e serializa todos os valores', async () => {
            const pool = makePool({ rows: [], rowCount: 1 });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);
            const highDimEmbedding = Array.from({ length: 320 }, (_, i) => i / 320);

            await repo.updateEmbeddings('vaga-001', highDimEmbedding);

            const vectorParam = getParams(pool)[0] as string;
            const parsed: number[] = JSON.parse(vectorParam);
            expect(parsed).toHaveLength(320);
            expect(parsed[0]).toBeCloseTo(0 / 320);
            expect(parsed[319]).toBeCloseTo(319 / 320);
        });

        it('preserva valores negativos e próximos de zero no literal pgvector', async () => {
            const pool = makePool({ rows: [], rowCount: 1 });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            await repo.updateEmbeddings('vaga-001', [-0.99, -0.5, 0.0, 0.5, 0.99]);

            const parsed: number[] = JSON.parse(getParams(pool)[0] as string);
            expect(parsed).toEqual([-0.99, -0.5, 0.0, 0.5, 0.99]);
        });

        it('chama a query exatamente uma vez por invocação', async () => {
            const pool = makePool({ rows: [], rowCount: 1 });
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            await repo.updateEmbeddings('vaga-001', [0.1, 0.2]);

            expect(pool.query).toHaveBeenCalledTimes(1);
        });

        it('propaga erro quando o banco rejeita o UPDATE (ex: id não existe)', async () => {
            const pool = makePool(new Error('Foreign key violation'));
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            await expect(
                repo.updateEmbeddings('id-inexistente', [0.1, 0.2])
            ).rejects.toThrow('Foreign key violation');
        });

        it('propaga erro de serialização do vetor no pgvector', async () => {
            const pgvectorError = new Error('invalid input syntax for type vector');
            (pgvectorError as any).code = '22P02';
            const pool = makePool(pgvectorError);
            const repo = new VagaRepositoryImpl(pool as unknown as Pool);

            await expect(
                repo.updateEmbeddings('vaga-001', [NaN, Infinity])
            ).rejects.toThrow('invalid input syntax for type vector');
        });
    });
});
