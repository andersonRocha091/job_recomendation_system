import * as fs from 'fs';
import * as tf from '@tensorflow/tfjs-node';

// Substitui as funções de I/O do fs para que runTraining() não toque o sistema de arquivos.
// existsSync passa para a implementação real por padrão — TF.js usa fs.existsSync para
// localizar seus bindings nativos em tempo de import; mockReturn(false) é aplicado
// apenas dentro do describe('runTraining') e restaurado no afterEach.
jest.mock('fs', () => {
    const realFs = jest.requireActual<typeof import('fs')>('fs');
    return {
        ...realFs,
        existsSync:    jest.fn().mockImplementation(realFs.existsSync),
        mkdirSync:     jest.fn(),
        writeFileSync: jest.fn(),
    };
});
import { TrainService } from '@core/domain/training/services/TrainService';
import { VocabularyService } from '@core/domain/training/services/VocabularyService';
import { ITreinamentoRepository } from '@core/ports/out/ITreinamentoRepository';
import { IVagaRepository } from '@core/ports/out/IVagaRepository';
import { TrainingRow } from '@core/domain/training/TrainingRow';
import { Vaga } from '@core/domain/Vaga';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Layout do vetor de features (deve espelhar o contrato de prepareTensor)
const MAX_SKILLS = 20;
const IDX_EXPERIENCE = MAX_SKILLS;           // índice 20
const IDX_JOB_SKILLS_START = MAX_SKILLS + 1; // índice 21
const IDX_SENIORITY_START = MAX_SKILLS * 2 + 1; // índice 41

const makeRow = (
    anosExperiencia: number,
    nivelSenioridade: string,
    skillsUsuario: string[] = [],
    skillsVaga: string[] = [],
    contratado: 0 | 1 = 0,
): TrainingRow => ({
    anosExperiencia,
    nivelSenioridade,
    skillsUsuario,
    skillsVaga,
    contratado,
});

const makeRepository = (): jest.Mocked<ITreinamentoRepository> => ({
    getRawTrainingData: jest.fn(),
});

const makeVagaRepository = (): jest.Mocked<IVagaRepository> => ({
    findAll: jest.fn(),
    findById: jest.fn(),
    updateEmbeddings: jest.fn(),
});

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
    habilidades: ['Node.js', 'TypeScript'],
    ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('TrainService', () => {
    let repository: jest.Mocked<ITreinamentoRepository>;
    let vagaRepository: jest.Mocked<IVagaRepository>;
    let vocabularyService: VocabularyService;
    let service: TrainService;

    beforeEach(() => {
        repository = makeRepository();
        vagaRepository = makeVagaRepository();
        vocabularyService = new VocabularyService();
        service = new TrainService(repository, vocabularyService, vagaRepository);
    });

    // -----------------------------------------------------------------------
    describe('constructor', () => {
        it('instancia sem erros com dependências válidas', () => {
            expect(service).toBeInstanceOf(TrainService);
        });
    });

    // -----------------------------------------------------------------------
    describe('extractMetadata()', () => {
        // -------------------------------------------------------------------
        describe('maxExperience e minExperience', () => {
            it('identifica corretamente o maior e o menor valor de experiência em múltiplas linhas', () => {
                const rows = [
                    makeRow(3, 'pleno'),
                    makeRow(7, 'senior'),
                    makeRow(1, 'junior'),
                ];
                const { maxExperience, minExperience } = service.extractMetadata(rows);

                expect(maxExperience).toBe(7);
                expect(minExperience).toBe(1);
            });

            it('cobre ambos os ramos falsos dos if de comparação com linhas em ordem não-monotônica', () => {
                // Row 1 (anos=5): 5 > -Inf → true, 5 < Inf → true  (define max=5, min=5)
                // Row 2 (anos=8): 8 > 5   → true, 8 < 5  → false  (define max=8, branch min=false)
                // Row 3 (anos=2): 2 > 8   → false, 2 < 5 → true   (branch max=false, define min=2)
                const rows = [
                    makeRow(5, 'pleno'),
                    makeRow(8, 'senior'),
                    makeRow(2, 'junior'),
                ];
                const { maxExperience, minExperience } = service.extractMetadata(rows);

                expect(maxExperience).toBe(8);
                expect(minExperience).toBe(2);
            });

            it('funciona corretamente com uma única linha de treinamento', () => {
                // Com uma linha, max === min → guarda de divisão por zero deve ser aplicada
                const { maxExperience, minExperience } = service.extractMetadata([makeRow(4, 'pleno')]);

                expect(minExperience).toBe(4);
                expect(maxExperience).toBe(5); // 4 + 1 pela guarda
            });

            it('suporta anos de experiência igual a zero', () => {
                const rows = [makeRow(0, 'estagiario'), makeRow(2, 'junior')];
                const { maxExperience, minExperience } = service.extractMetadata(rows);

                expect(minExperience).toBe(0);
                expect(maxExperience).toBe(2);
            });

            it('suporta anos de experiência com valores decimais', () => {
                const rows = [makeRow(1.5, 'junior'), makeRow(3.75, 'pleno')];
                const { maxExperience, minExperience } = service.extractMetadata(rows);

                expect(minExperience).toBe(1.5);
                expect(maxExperience).toBe(3.75);
            });
        });

        // -------------------------------------------------------------------
        describe('guarda de divisão por zero (maxExperience === minExperience)', () => {
            it('incrementa maxExperience em 1 quando todas as linhas têm a mesma experiência', () => {
                const rows = [
                    makeRow(5, 'pleno'),
                    makeRow(5, 'senior'),
                    makeRow(5, 'junior'),
                ];
                const { maxExperience, minExperience } = service.extractMetadata(rows);

                expect(minExperience).toBe(5);
                expect(maxExperience).toBe(6); // 5 + 1 pela guarda
            });

            it('NÃO aplica a guarda quando max e min são distintos', () => {
                const rows = [makeRow(2, 'junior'), makeRow(6, 'senior')];
                const { maxExperience, minExperience } = service.extractMetadata(rows);

                // Sem modificação — max permanece exatamente como extraído
                expect(maxExperience).toBe(6);
                expect(minExperience).toBe(2);
            });

            it('garante que maxExperience > minExperience após a guarda (divisão por zero impossível)', () => {
                // Invariante crítico para a normalização min-max
                const rows = [makeRow(10, 'senior'), makeRow(10, 'senior')];
                const { maxExperience, minExperience } = service.extractMetadata(rows);

                expect(maxExperience).toBeGreaterThan(minExperience);
            });
        });

        // -------------------------------------------------------------------
        describe('seniorityList — coleta para one-hot encoding', () => {
            it('retorna a lista de senioridades únicas presentes nas linhas', () => {
                const rows = [
                    makeRow(1, 'junior'),
                    makeRow(3, 'pleno'),
                    makeRow(7, 'senior'),
                ];
                const { seniorityList } = service.extractMetadata(rows);

                expect(seniorityList).toHaveLength(3);
                expect(seniorityList).toContain('junior');
                expect(seniorityList).toContain('pleno');
                expect(seniorityList).toContain('senior');
            });

            it('normaliza todas as senioridades para lowercase', () => {
                const rows = [
                    makeRow(1, 'Junior'),
                    makeRow(3, 'PLENO'),
                    makeRow(7, 'Sênior'),
                ];
                const { seniorityList } = service.extractMetadata(rows);

                expect(seniorityList).toContain('junior');
                expect(seniorityList).toContain('pleno');
                expect(seniorityList).toContain('sênior');
                seniorityList.forEach(s => expect(s).toBe(s.toLowerCase()));
            });

            it('desduplicação: mesma senioridade em múltiplas linhas aparece apenas uma vez', () => {
                const rows = [
                    makeRow(1, 'junior'),
                    makeRow(2, 'junior'),
                    makeRow(3, 'pleno'),
                    makeRow(4, 'junior'),
                ];
                const { seniorityList } = service.extractMetadata(rows);

                expect(seniorityList).toHaveLength(2);
                expect(seniorityList.filter(s => s === 'junior')).toHaveLength(1);
            });

            it('desduplicação: senioridades iguais em cases diferentes são agrupadas', () => {
                // 'Senior', 'SENIOR', 'senior' → todos se tornam 'senior' → 1 entrada
                const rows = [
                    makeRow(5, 'Senior'),
                    makeRow(6, 'SENIOR'),
                    makeRow(7, 'senior'),
                ];
                const { seniorityList } = service.extractMetadata(rows);

                expect(seniorityList).toHaveLength(1);
                expect(seniorityList[0]).toBe('senior');
            });

            it('preserva a ordem de inserção (primeira ocorrência) — relevante para índices do one-hot', () => {
                const rows = [
                    makeRow(1, 'pleno'),
                    makeRow(7, 'senior'),
                    makeRow(2, 'junior'),
                ];
                const { seniorityList } = service.extractMetadata(rows);

                // A ordem deve refletir a sequência de primeiras ocorrências
                expect(seniorityList[0]).toBe('pleno');
                expect(seniorityList[1]).toBe('senior');
                expect(seniorityList[2]).toBe('junior');
            });
        });

        // -------------------------------------------------------------------
        describe('vocabSize — integração com VocabularyService', () => {
            it('retorna vocabSize=0 quando o vocabulário ainda não foi construído', () => {
                const { vocabSize } = service.extractMetadata([makeRow(3, 'pleno')]);

                expect(vocabSize).toBe(0);
            });

            it('reflete o tamanho do vocabulário após o build do VocabularyService', () => {
                vocabularyService.build([
                    makeRow(3, 'pleno', ['Node.js', 'TypeScript'], ['Node.js', 'AWS']),
                ]);
                // Node.js(dup), TypeScript, AWS → 3 skills únicas
                const { vocabSize } = service.extractMetadata([makeRow(3, 'pleno')]);

                expect(vocabSize).toBe(3);
            });

            it('reflete atualização do vocabulário entre chamadas successivas de extractMetadata', () => {
                const row = makeRow(3, 'pleno', ['Python'], ['FastAPI']);

                const before = service.extractMetadata([row]);
                expect(before.vocabSize).toBe(0);

                vocabularyService.build([row]);

                const after = service.extractMetadata([row]);
                expect(after.vocabSize).toBe(2); // Python, FastAPI
            });
        });

        // -------------------------------------------------------------------
        describe('persistência interna — this.metadata', () => {
            it('chamadas consecutivas retornam os metadados da última invocação', () => {
                const firstRows = [makeRow(1, 'junior'), makeRow(5, 'senior')];
                const secondRows = [makeRow(10, 'especialista')];

                service.extractMetadata(firstRows);
                const second = service.extractMetadata(secondRows);

                // O resultado de secondRows: max===min=10 → guarda → max=11
                expect(second.maxExperience).toBe(11);
                expect(second.minExperience).toBe(10);
                expect(second.seniorityList).toContain('especialista');
            });
        });

        // -------------------------------------------------------------------
        describe('comportamento com entradas extremas', () => {
            it('aceita linhas com arrays de skills vazios sem erros', () => {
                expect(() =>
                    service.extractMetadata([makeRow(3, 'pleno', [], [])]),
                ).not.toThrow();
            });

            it('documenta comportamento com array de linhas vazio: retorna valores sentinela', () => {
                // ATENÇÃO: com rows=[], os valores extremos (-Infinity / Infinity) são retornados.
                // O caller é responsável por garantir que rows não seja vazio antes de chamar
                // extractMetadata, pois esses valores tornarão a normalização min-max inválida.
                const { maxExperience, minExperience, seniorityList } = service.extractMetadata([]);

                expect(maxExperience).toBe(-Infinity);
                expect(minExperience).toBe(Infinity);
                expect(seniorityList).toHaveLength(0);
            });
        });
    });

    // -----------------------------------------------------------------------
    describe('prepareTensor()', () => {

        // Tensores alocados em memória TF precisam ser liberados após cada teste
        const disposables: tf.Tensor[] = [];
        const track = <T extends tf.Tensor>(t: T): T => { disposables.push(t); return t; };

        afterEach(() => {
            while (disposables.length) disposables.pop()!.dispose();
        });

        // -------------------------------------------------------------------
        describe('shape dos tensores', () => {
            it('xInputs tem shape [n_linhas, 41 + n_senioridades] e yLabels [n_linhas, 1]', async () => {
                vocabularyService.build([makeRow(3, 'junior', ['Node.js'], ['AWS'])]);

                const rows = [
                    makeRow(3, 'junior', ['Node.js'], ['AWS']),
                    makeRow(7, 'senior', ['Python'], ['FastAPI']),
                ];
                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                // 20 user skills + 1 exp + 20 job skills + 2 senioridades = 43
                expect(xInputs.shape).toEqual([2, 43]);
                expect(yLabels.shape).toEqual([2, 1]);
            });

            it('shape se adapta ao número de senioridades distintas no dataset', async () => {
                vocabularyService.build([makeRow(1, 'junior', [], [])]);

                const rows = [
                    makeRow(1, 'junior'),
                    makeRow(3, 'pleno'),
                    makeRow(7, 'senior'),
                ];
                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                // 20 + 1 + 20 + 3 senioridades = 44
                expect(xInputs.shape).toEqual([3, 44]);
                expect(yLabels.shape).toEqual([3, 1]);
            });

            it('dataset com senioridade única gera vetor one-hot de tamanho 1', async () => {
                vocabularyService.build([makeRow(5, 'pleno', [], [])]);

                const rows = [makeRow(5, 'pleno'), makeRow(5, 'pleno')];
                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                // 20 + 1 + 20 + 1 senioridade = 42
                expect(xInputs.shape).toEqual([2, 42]);
                expect(yLabels.shape).toEqual([2, 1]);
            });
        });

        // -------------------------------------------------------------------
        describe('normalização da experiência (índice 20 do vetor)', () => {
            it('linha com minExperience é normalizada para 0.0', async () => {
                vocabularyService.build([makeRow(2, 'junior', [], [])]);

                const rows = [makeRow(2, 'junior'), makeRow(8, 'senior')];
                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                const matrix = xInputs.arraySync() as number[][];
                // Linha 0: (2 - 2) / (8 - 2) = 0
                expect(matrix[0][IDX_EXPERIENCE]).toBeCloseTo(0.0);
            });

            it('linha com maxExperience é normalizada para 1.0', async () => {
                vocabularyService.build([makeRow(2, 'junior', [], [])]);

                const rows = [makeRow(2, 'junior'), makeRow(8, 'senior')];
                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                const matrix = xInputs.arraySync() as number[][];
                // Linha 1: (8 - 2) / (8 - 2) = 1
                expect(matrix[1][IDX_EXPERIENCE]).toBeCloseTo(1.0);
            });

            it('linha intermediária recebe valor proporcional entre 0 e 1', async () => {
                vocabularyService.build([makeRow(2, 'junior', [], [])]);

                const rows = [makeRow(2, 'junior'), makeRow(5, 'pleno'), makeRow(8, 'senior')];
                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                const matrix = xInputs.arraySync() as number[][];
                // Linha 1: (5 - 2) / (8 - 2) = 3/6 = 0.5
                expect(matrix[1][IDX_EXPERIENCE]).toBeCloseTo(0.5);
            });

            it('linha única (max===min, guarda ativada) é normalizada para 0.0', async () => {
                // max === min → guarda incrementa max em 1 → (x - x) / 1 = 0
                vocabularyService.build([makeRow(4, 'pleno', [], [])]);

                const rows = [makeRow(4, 'pleno')];
                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                const matrix = xInputs.arraySync() as number[][];
                expect(matrix[0][IDX_EXPERIENCE]).toBeCloseTo(0.0);
            });

            it('garante que os valores normalizados estão sempre no intervalo [0, 1]', async () => {
                vocabularyService.build([makeRow(0, 'estagiario', [], [])]);

                const rows = [
                    makeRow(0,  'estagiario'),
                    makeRow(2,  'junior'),
                    makeRow(5,  'pleno'),
                    makeRow(10, 'senior'),
                    makeRow(15, 'especialista'),
                ];
                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                const matrix = xInputs.arraySync() as number[][];
                matrix.forEach(row => {
                    expect(row[IDX_EXPERIENCE]).toBeGreaterThanOrEqual(0);
                    expect(row[IDX_EXPERIENCE]).toBeLessThanOrEqual(1);
                });
            });
        });

        // -------------------------------------------------------------------
        describe('tokenização das skills', () => {
            it('pré-condição: sem vocabulário construído, todas as skills recebem token 0', async () => {
                // vocabularyService.build() NÃO foi chamado — precondição violada
                const rows = [makeRow(3, 'pleno', ['Node.js', 'TypeScript'], ['AWS', 'Docker'])];
                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                const matrix = xInputs.arraySync() as number[][];
                const userSkillSlice = matrix[0].slice(0, MAX_SKILLS);
                const jobSkillSlice  = matrix[0].slice(IDX_JOB_SKILLS_START, IDX_JOB_SKILLS_START + MAX_SKILLS);

                expect(userSkillSlice.every(t => t === 0)).toBe(true);
                expect(jobSkillSlice.every(t => t === 0)).toBe(true);
            });

            it('skills conhecidas recebem índice ≥ 1 após build do vocabulário', async () => {
                const rows = [makeRow(3, 'pleno', ['Node.js', 'TypeScript'], ['AWS', 'Docker'])];
                vocabularyService.build(rows);

                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                const matrix = xInputs.arraySync() as number[][];
                // As 2 primeiras posições de user skills devem ter índices ≥ 1
                expect(matrix[0][0]).toBeGreaterThanOrEqual(1); // Node.js
                expect(matrix[0][1]).toBeGreaterThanOrEqual(1); // TypeScript
                // As 2 primeiras posições de job skills devem ter índices ≥ 1
                expect(matrix[0][IDX_JOB_SKILLS_START]).toBeGreaterThanOrEqual(1);     // AWS
                expect(matrix[0][IDX_JOB_SKILLS_START + 1]).toBeGreaterThanOrEqual(1); // Docker
            });

            it('skills desconhecidas (fora do vocabulário) recebem token 0', async () => {
                vocabularyService.build([makeRow(3, 'pleno', ['Node.js'], ['AWS'])]);

                // Rust e Haskell não estão no vocabulário
                const rows = [makeRow(3, 'pleno', ['Rust', 'Haskell'], ['COBOL'])];
                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                const matrix = xInputs.arraySync() as number[][];
                expect(matrix[0][0]).toBe(0); // Rust — desconhecida
                expect(matrix[0][1]).toBe(0); // Haskell — desconhecida
                expect(matrix[0][IDX_JOB_SKILLS_START]).toBe(0); // COBOL — desconhecida
            });

            it('posições além das skills fornecidas são preenchidas com padding (0)', async () => {
                const rows = [makeRow(3, 'pleno', ['Node.js'], ['AWS'])];
                vocabularyService.build(rows);

                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                const matrix = xInputs.arraySync() as number[][];
                // Apenas 1 skill fornecida; posições 1-19 devem ser 0 (padding)
                const userPaddingSlice = matrix[0].slice(1, MAX_SKILLS);
                expect(userPaddingSlice.every(t => t === 0)).toBe(true);

                const jobPaddingSlice = matrix[0].slice(IDX_JOB_SKILLS_START + 1, IDX_JOB_SKILLS_START + MAX_SKILLS);
                expect(jobPaddingSlice.every(t => t === 0)).toBe(true);
            });

            it('skills de linhas distintas são tokenizadas independentemente', async () => {
                const rows = [
                    makeRow(2, 'junior', ['Node.js'], ['AWS']),
                    makeRow(8, 'senior', ['Python'],  ['GCP']),
                ];
                vocabularyService.build(rows);

                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                const matrix = xInputs.arraySync() as number[][];
                // Os tokens da linha 0 e linha 1 devem ser diferentes (skills distintas)
                expect(matrix[0][0]).not.toBe(matrix[1][0]);
            });
        });

        // -------------------------------------------------------------------
        describe('one-hot encoding da senioridade (índice 41+)', () => {
            it('primeira senioridade da lista recebe posição 0 = 1, demais = 0', async () => {
                // Ordem de inserção: junior (idx 0), senior (idx 1)
                const rows = [
                    makeRow(1, 'junior'),
                    makeRow(7, 'senior'),
                ];
                vocabularyService.build(rows);
                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                const matrix = xInputs.arraySync() as number[][];
                // Linha 0 (junior): one-hot = [1, 0]
                expect(matrix[0][IDX_SENIORITY_START]).toBe(1);
                expect(matrix[0][IDX_SENIORITY_START + 1]).toBe(0);
            });

            it('segunda senioridade da lista recebe posição 1 = 1, demais = 0', async () => {
                const rows = [
                    makeRow(1, 'junior'),
                    makeRow(7, 'senior'),
                ];
                vocabularyService.build(rows);
                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                const matrix = xInputs.arraySync() as number[][];
                // Linha 1 (senior): one-hot = [0, 1]
                expect(matrix[1][IDX_SENIORITY_START]).toBe(0);
                expect(matrix[1][IDX_SENIORITY_START + 1]).toBe(1);
            });

            it('one-hot é case-insensitive: "Junior" e "junior" mapeiam para o mesmo índice', async () => {
                const rows = [
                    makeRow(1, 'junior'),  // lowercase — primeira inserção
                    makeRow(3, 'Junior'),  // mixed case — deve mapear ao mesmo índice
                    makeRow(7, 'senior'),
                ];
                vocabularyService.build(rows);
                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                const matrix = xInputs.arraySync() as number[][];
                // Linha 0 e Linha 1 devem ter o mesmo one-hot (ambas são 'junior')
                const oneHot0 = matrix[0].slice(IDX_SENIORITY_START);
                const oneHot1 = matrix[1].slice(IDX_SENIORITY_START);
                expect(oneHot0).toEqual(oneHot1);
                expect(oneHot0[0]).toBe(1); // posição de 'junior'
            });

            it('vetores one-hot de linhas com senioridades distintas são mutuamente exclusivos', async () => {
                const rows = [
                    makeRow(1, 'junior'),
                    makeRow(3, 'pleno'),
                    makeRow(7, 'senior'),
                ];
                vocabularyService.build(rows);
                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                const matrix = xInputs.arraySync() as number[][];
                // Cada linha deve ter exatamente um 1 e os demais 0 no segmento one-hot
                for (let i = 0; i < rows.length; i++) {
                    const oneHot = matrix[i].slice(IDX_SENIORITY_START);
                    const sumOnes = oneHot.reduce((acc, v) => acc + v, 0);
                    expect(sumOnes).toBe(1);
                }
            });
        });

        // -------------------------------------------------------------------
        describe('yLabels', () => {
            it('linha com contratado=0 gera label 0.0', async () => {
                const rows = [makeRow(3, 'pleno', [], [], 0)];
                vocabularyService.build(rows);

                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                const labels = yLabels.arraySync() as number[][];
                expect(labels[0][0]).toBe(0);
            });

            it('linha com contratado=1 gera label 1.0', async () => {
                const rows = [makeRow(3, 'pleno', [], [], 1)];
                vocabularyService.build(rows);

                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                const labels = yLabels.arraySync() as number[][];
                expect(labels[0][0]).toBe(1);
            });

            it('ordem e valores das labels correspondem à ordem das linhas de entrada', async () => {
                const rows = [
                    makeRow(1, 'junior', [], [], 0),
                    makeRow(5, 'pleno',  [], [], 1),
                    makeRow(9, 'senior', [], [], 0),
                    makeRow(3, 'junior', [], [], 1),
                ];
                vocabularyService.build(rows);

                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                const labels = (yLabels.arraySync() as number[][]).map(l => l[0]);
                expect(labels).toEqual([0, 1, 0, 1]);
            });
        });

        // -------------------------------------------------------------------
        describe('metaData retornado', () => {
            it('retorna os metadados equivalentes à chamada de extractMetadata com as mesmas rows', async () => {
                const rows = [
                    makeRow(2, 'junior', ['Node.js'], ['AWS']),
                    makeRow(8, 'senior', ['Python'],  ['GCP']),
                ];
                vocabularyService.build(rows);

                const expectedMeta = service.extractMetadata(rows);
                const { xInputs, yLabels, metaData } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                expect(metaData.maxExperience).toBe(expectedMeta.maxExperience);
                expect(metaData.minExperience).toBe(expectedMeta.minExperience);
                expect(metaData.seniorityList).toEqual(expectedMeta.seniorityList);
                expect(metaData.vocabSize).toBe(expectedMeta.vocabSize);
            });
        });

        // -------------------------------------------------------------------
        describe('integridade do layout completo do vetor de features', () => {
            it('verifica os três segmentos do vetor: user skills | exp | job skills | one-hot', async () => {
                // Cenário realista: candidato junior Node.js para vaga AWS
                const rows = [makeRow(3, 'junior', ['Node.js', 'TypeScript'], ['AWS', 'Docker'])];
                vocabularyService.build(rows);

                const { xInputs, yLabels } = await service.prepareTensor(rows);
                track(xInputs); track(yLabels);

                const vec = (xInputs.arraySync() as number[][])[0];

                // Segmento 1: user skills (índices 0-19) — 2 tokens ≥ 1, restante 0
                const userTokens = vec.slice(0, MAX_SKILLS);
                expect(userTokens[0]).toBeGreaterThanOrEqual(1); // Node.js
                expect(userTokens[1]).toBeGreaterThanOrEqual(1); // TypeScript
                expect(userTokens.slice(2).every(t => t === 0)).toBe(true); // padding

                // Segmento 2: experiência normalizada (índice 20)
                // Única linha → max===min, guarda → (3-3)/(4-3) = 0
                expect(vec[IDX_EXPERIENCE]).toBeCloseTo(0.0);

                // Segmento 3: job skills (índices 21-40) — 2 tokens ≥ 1, restante 0
                const jobTokens = vec.slice(IDX_JOB_SKILLS_START, IDX_JOB_SKILLS_START + MAX_SKILLS);
                expect(jobTokens[0]).toBeGreaterThanOrEqual(1); // AWS
                expect(jobTokens[1]).toBeGreaterThanOrEqual(1); // Docker
                expect(jobTokens.slice(2).every(t => t === 0)).toBe(true); // padding

                // Segmento 4: one-hot seniority (índice 41) — única senioridade → [1]
                expect(vec[IDX_SENIORITY_START]).toBe(1);

                // Comprimento total do vetor
                expect(vec).toHaveLength(IDX_SENIORITY_START + 1); // 41 + 1 senioridade = 42
            });
        });
    });

    // -----------------------------------------------------------------------
    describe('buildModel()', () => {

        let model: tf.LayersModel;

        afterEach(() => { model?.dispose(); });

        // helper: retorna o config de uma camada como objeto genérico
        const layerConfig = (name: string): Record<string, any> =>
            model.getLayer(name).getConfig() as Record<string, any>;

        // -------------------------------------------------------------------
        describe('retorno', () => {
            it('retorna um objeto LayersModel com API de predição e treino', () => {
                model = service.buildModel(100, 3);

                expect(model).toBeDefined();
                expect(typeof model.predict).toBe('function');
                expect(typeof model.fit).toBe('function');
                expect(Array.isArray(model.inputs)).toBe(true);
                expect(Array.isArray(model.outputs)).toBe(true);
            });
        });

        // -------------------------------------------------------------------
        describe('entradas (inputs)', () => {
            it('modelo possui exatamente 3 entradas independentes', () => {
                model = service.buildModel(100, 3);

                expect(model.inputs).toHaveLength(3);
            });

            it('user_skills_input tem shape [null, 20] — sequência de 20 tokens', () => {
                model = service.buildModel(100, 3);

                expect(model.getLayer('user_skills_input')).toBeDefined();
                expect(model.inputs[0].shape).toEqual([null, 20]);
            });

            it('job_skills_input tem shape [null, 20] — sequência de 20 tokens da vaga', () => {
                model = service.buildModel(100, 3);

                expect(model.getLayer('job_skills_input')).toBeDefined();
                expect(model.inputs[1].shape).toEqual([null, 20]);
            });

            it('numeric_input tem shape [null, 1 + seniorityCount] — experiência + one-hot', () => {
                model = service.buildModel(100, 3);

                expect(model.getLayer('numeric_input')).toBeDefined();
                // 1 (experiência normalizada) + 3 (one-hot) = shape [null, 4]
                expect(model.inputs[2].shape).toEqual([null, 4]);
            });

            it('shape de numeric_input se adapta ao parâmetro seniorityCount', () => {
                model = service.buildModel(100, 5);
                expect(model.inputs[2].shape).toEqual([null, 6]); // 1 + 5

                model.dispose();

                model = service.buildModel(100, 1);
                expect(model.inputs[2].shape).toEqual([null, 2]); // 1 + 1
            });

            it('numeric_input com seniorityCount=0 gera shape [null, 1] — apenas experiência', () => {
                // Documenta comportamento de borda: sem senioridades, só experiência
                model = service.buildModel(100, 0);

                expect(model.inputs[2].shape).toEqual([null, 1]);
            });
        });

        // -------------------------------------------------------------------
        describe('saída (output)', () => {
            it('modelo possui exatamente 1 saída — classificação binária', () => {
                model = service.buildModel(100, 3);

                expect(model.outputs).toHaveLength(1);
            });

            it('output shape é [null, 1] — probabilidade escalar por amostra', () => {
                model = service.buildModel(100, 3);

                expect(model.outputs[0].shape).toEqual([null, 1]);
            });

            it('camada hiring_probability usa ativação sigmoid — crítico para saída em [0, 1]', () => {
                model = service.buildModel(100, 3);

                const activation = JSON.stringify(layerConfig('hiring_probability')['activation']).toLowerCase();
                expect(activation).toContain('sigmoid');
            });

            it('camada de saída produz 1 unidade', () => {
                model = service.buildModel(100, 3);

                expect(layerConfig('hiring_probability')['units']).toBe(1);
            });
        });

        // -------------------------------------------------------------------
        describe('skill_embedding', () => {
            it('camada skill_embedding existe no grafo do modelo', () => {
                model = service.buildModel(100, 3);

                expect(() => model.getLayer('skill_embedding')).not.toThrow();
            });

            it('inputDim do embedding reflete o parâmetro vocabularySize', () => {
                model = service.buildModel(200, 3);
                expect(layerConfig('skill_embedding')['inputDim']).toBe(200);

                model.dispose();

                model = service.buildModel(500, 3);
                expect(layerConfig('skill_embedding')['inputDim']).toBe(500);
            });

            it('outputDim é 16 — cada skill é representada como vetor de 16 dimensões', () => {
                model = service.buildModel(100, 3);

                expect(layerConfig('skill_embedding')['outputDim']).toBe(16);
            });

            it('maskZero=true — tokens de padding (0) são ignorados pelo embedding', () => {
                model = service.buildModel(100, 3);

                expect(layerConfig('skill_embedding')['maskZero']).toBe(true);
            });

            it('embedding é compartilhado entre user e job skills (weight sharing)', () => {
                // Decisão arquitetural: skills têm o mesmo significado semântico nos
                // dois contextos — um único embedding captura essa representação.
                // Verificado pelo fato de haver exatamente 1 camada Embedding no modelo.
                model = service.buildModel(100, 3);

                const embeddingLayers = model.layers.filter(l => l.getClassName() === 'Embedding');
                expect(embeddingLayers).toHaveLength(1);
            });
        });

        // -------------------------------------------------------------------
        describe('topologia da rede', () => {
            it('possui exatamente 2 camadas Flatten — uma para user skills, outra para job skills', () => {
                model = service.buildModel(100, 3);

                const flattenLayers = model.layers.filter(l => l.getClassName() === 'Flatten');
                expect(flattenLayers).toHaveLength(2);
            });

            it('possui uma camada Concatenate que une os três fluxos de features', () => {
                model = service.buildModel(100, 3);

                const concatenateLayers = model.layers.filter(l => l.getClassName() === 'Concatenate');
                expect(concatenateLayers).toHaveLength(1);
            });

            it('possui exatamente 3 camadas Dense (32-relu, 16-relu, 1-sigmoid)', () => {
                model = service.buildModel(100, 3);

                const denseLayers = model.layers.filter(l => l.getClassName() === 'Dense');
                expect(denseLayers).toHaveLength(3);
            });

            it('camadas densas intermediárias usam ativação relu — aprendizado não-linear', () => {
                model = service.buildModel(100, 3);

                const hiddenDense = model.layers
                    .filter(l => l.getClassName() === 'Dense' && l.name !== 'hiring_probability');
                expect(hiddenDense).toHaveLength(2);

                hiddenDense.forEach(layer => {
                    const activation = JSON.stringify(
                        (layer.getConfig() as Record<string, any>)['activation']
                    ).toLowerCase();
                    expect(activation).toContain('relu');
                });
            });

            it('camadas densas têm units 32 e 16 respectivamente', () => {
                model = service.buildModel(100, 3);

                const units = model.layers
                    .filter(l => l.getClassName() === 'Dense' && l.name !== 'hiring_probability')
                    .map(l => (l.getConfig() as Record<string, any>)['units'])
                    .sort((a, b) => b - a);

                expect(units).toEqual([32, 16]);
            });
        });

        // -------------------------------------------------------------------
        describe('compilação', () => {
            it('modelo foi compilado — optimizer está definido', () => {
                model = service.buildModel(100, 3);

                expect(model.optimizer).toBeDefined();
                expect(model.optimizer).not.toBeNull();
            });

            it('loss é binaryCrossentropy — adequado para classificação binária (contratado: 0|1)', () => {
                model = service.buildModel(100, 3);

                const loss = JSON.stringify(model.loss).toLowerCase();
                expect(loss).toContain('binarycrossentropy');
            });

            it('métricas incluem accuracy para monitoramento do treino', () => {
                model = service.buildModel(100, 3);

                const metrics = model.metricsNames.map(m => m.toLowerCase());
                const hasAccuracy = metrics.some(m => m.includes('acc'));
                expect(hasAccuracy).toBe(true);
            });
        });

        // -------------------------------------------------------------------
        describe('independência entre instâncias', () => {
            it('dois modelos criados com parâmetros diferentes são independentes', () => {
                const modelA = service.buildModel(100, 2);
                const modelB = service.buildModel(300, 5);

                expect(modelA.inputs[2].shape).toEqual([null, 3]); // 1 + 2
                expect(modelB.inputs[2].shape).toEqual([null, 6]); // 1 + 5
                expect((modelA.getLayer('skill_embedding').getConfig() as any)['inputDim']).toBe(100);
                expect((modelB.getLayer('skill_embedding').getConfig() as any)['inputDim']).toBe(300);

                modelA.dispose();
                model = modelB; // afterEach dispose modelB
            });
        });
    });

    // -----------------------------------------------------------------------
    describe('prepareSingleJobTensor()', () => {

        // Dados de treino usados para popular metadata e vocabulário
        const trainingRows = [
            makeRow(2, 'junior', ['Node.js', 'TypeScript'], ['AWS', 'Docker']),
            makeRow(8, 'senior', ['Python', 'Django'],      ['GCP', 'Kubernetes']),
        ];

        const tensors: tf.Tensor[] = [];
        const track = <T extends tf.Tensor>(t: T): T => { tensors.push(t); return t; };

        beforeEach(() => {
            vocabularyService.build(trainingRows);
            service.extractMetadata(trainingRows);
        });

        afterEach(() => {
            while (tensors.length) tensors.pop()!.dispose();
        });

        it('lança erro quando extractMetadata não foi chamado antes', () => {
            // Instância nova sem metadata extraída
            const freshService = new TrainService(repository, new VocabularyService(), vagaRepository);

            expect(() => freshService.prepareSingleJobTensor(makeVaga()))
                .toThrow('Metadata não extraída. Execute extractMetadata() antes.');
        });

        it('retorna skills tensor com shape [1, 20] — sequência de tokens da vaga', () => {
            const { skills, numeric } = service.prepareSingleJobTensor(makeVaga());
            track(skills); track(numeric);

            expect(skills.shape).toEqual([1, 20]);
        });

        it('retorna numeric tensor com shape [1, 1 + n_senioridades]', () => {
            // 2 senioridades no training set (junior, senior) → shape [1, 3]
            const { skills, numeric } = service.prepareSingleJobTensor(makeVaga());
            track(skills); track(numeric);

            expect(numeric.shape).toEqual([1, 3]); // 1 experiência + 2 one-hot
        });

        it('normalizedExperience é sempre 0 no índice 0 do tensor numeric (vagas não têm anos)', () => {
            const { skills, numeric } = service.prepareSingleJobTensor(makeVaga());
            track(skills); track(numeric);

            const numericArr = (numeric.arraySync() as number[][])[0];
            expect(numericArr[0]).toBe(0); // placeholder de experiência
        });

        it('one-hot encoding: seniority conhecida ativa a posição correta', () => {
            // seniorityList = ['junior', 'senior'] (ordem de inserção)
            const vagaJunior = makeVaga({ nivelSenioridade: 'junior' });
            const vagaSenior = makeVaga({ nivelSenioridade: 'senior' });

            const resJunior = service.prepareSingleJobTensor(vagaJunior);
            const resSenior = service.prepareSingleJobTensor(vagaSenior);
            track(resJunior.skills); track(resJunior.numeric);
            track(resSenior.skills); track(resSenior.numeric);

            const numericJunior = (resJunior.numeric.arraySync() as number[][])[0];
            const numericSenior = (resSenior.numeric.arraySync() as number[][])[0];

            // junior é idx 0 da lista → posição 1 do tensor (após a experiência)
            expect(numericJunior[1]).toBe(1); // junior ativado
            expect(numericJunior[2]).toBe(0); // senior desativado

            // senior é idx 1 da lista
            expect(numericSenior[1]).toBe(0); // junior desativado
            expect(numericSenior[2]).toBe(1); // senior ativado
        });

        it('seniority desconhecida (não vista no treino) → one-hot all zeros, sem erro', () => {
            // Cobre o ramo `if (seniorityIndex >= 0)` quando seniorityIndex = -1
            const vagaDesconhecida = makeVaga({ nivelSenioridade: 'especialista' });

            const { skills, numeric } = service.prepareSingleJobTensor(vagaDesconhecida);
            track(skills); track(numeric);

            const numericArr = (numeric.arraySync() as number[][])[0];
            const oneHotPart = numericArr.slice(1); // ignora o placeholder de experiência
            expect(oneHotPart.every(v => v === 0)).toBe(true);
        });

        it('skills da vaga são tokenizadas pelo vocabulário', () => {
            const vaga = makeVaga({ habilidades: ['Node.js', 'TypeScript'] });
            const { skills } = service.prepareSingleJobTensor(vaga);
            track(skills);

            const skillsArr = (skills.arraySync() as number[][])[0];
            // As 2 primeiras posições devem ter tokens ≥ 1 (skills conhecidas)
            expect(skillsArr[0]).toBeGreaterThanOrEqual(1);
            expect(skillsArr[1]).toBeGreaterThanOrEqual(1);
        });

        it('habilidades undefined → all padding zeros no tensor de skills', () => {
            const vaga = makeVaga({ habilidades: undefined });
            const { skills } = service.prepareSingleJobTensor(vaga);
            track(skills);

            const skillsArr = (skills.arraySync() as number[][])[0];
            expect(skillsArr.every(v => v === 0)).toBe(true);
        });

        it('habilidades vazia → all padding zeros no tensor de skills', () => {
            const vaga = makeVaga({ habilidades: [] });
            const { skills } = service.prepareSingleJobTensor(vaga);
            track(skills);

            const skillsArr = (skills.arraySync() as number[][])[0];
            expect(skillsArr.every(v => v === 0)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    describe('syncDatabaseEmbeddings()', () => {

        let model: tf.LayersModel;

        // Dataset mínimo com 2 senioridades para a rede ter entradas válidas
        const trainingRows = [
            makeRow(2, 'junior', ['Node.js'], ['AWS']),
            makeRow(8, 'senior', ['Python'], ['GCP']),
        ];

        beforeEach(() => {
            vocabularyService.build(trainingRows);
            service.extractMetadata(trainingRows);
            model = service.buildModel(vocabularyService.size(), 2);
            vagaRepository.updateEmbeddings.mockResolvedValue(undefined);
        });

        afterEach(() => { model?.dispose(); });

        it('chama vagaRepository.findAll() para buscar as vagas ativas', async () => {
            vagaRepository.findAll.mockResolvedValue([]);

            await service.syncDatabaseEmbeddings(model);

            expect(vagaRepository.findAll).toHaveBeenCalledTimes(1);
        });

        it('não chama updateEmbeddings quando não há vagas ativas', async () => {
            vagaRepository.findAll.mockResolvedValue([]);

            await service.syncDatabaseEmbeddings(model);

            expect(vagaRepository.updateEmbeddings).not.toHaveBeenCalled();
        });

        it('chama updateEmbeddings uma vez para cada vaga ativa', async () => {
            vagaRepository.findAll.mockResolvedValue([
                makeVaga({ id: 'vaga-1', nivelSenioridade: 'junior' }),
                makeVaga({ id: 'vaga-2', nivelSenioridade: 'senior' }),
                makeVaga({ id: 'vaga-3', nivelSenioridade: 'junior' }),
            ]);

            await service.syncDatabaseEmbeddings(model);

            expect(vagaRepository.updateEmbeddings).toHaveBeenCalledTimes(3);
        });

        it('passa o id correto de cada vaga para updateEmbeddings', async () => {
            vagaRepository.findAll.mockResolvedValue([
                makeVaga({ id: 'vaga-abc', nivelSenioridade: 'junior' }),
                makeVaga({ id: 'vaga-xyz', nivelSenioridade: 'senior' }),
            ]);

            await service.syncDatabaseEmbeddings(model);

            expect(vagaRepository.updateEmbeddings).toHaveBeenCalledWith('vaga-abc', expect.any(Array));
            expect(vagaRepository.updateEmbeddings).toHaveBeenCalledWith('vaga-xyz', expect.any(Array));
        });

        it('passa um array de números como embeddings — vetor de saída da feature_projection_layer', async () => {
            vagaRepository.findAll.mockResolvedValue([
                makeVaga({ id: 'vaga-1', nivelSenioridade: 'junior' }),
            ]);

            await service.syncDatabaseEmbeddings(model);

            const [, embeddings] = vagaRepository.updateEmbeddings.mock.calls[0];
            expect(Array.isArray(embeddings)).toBe(true);
            expect(embeddings.length).toBeGreaterThan(0);
            expect(embeddings.every((v: any) => typeof v === 'number')).toBe(true);
        });

        it('embeddings têm dimensão igual ao número de unidades da feature_projection_layer (32)', async () => {
            vagaRepository.findAll.mockResolvedValue([
                makeVaga({ id: 'vaga-1', nivelSenioridade: 'pleno' }),
            ]);
            // 'pleno' não está na lista de treino → one-hot all zeros, mas não deve lançar erro

            await service.syncDatabaseEmbeddings(model);

            const [, embeddings] = vagaRepository.updateEmbeddings.mock.calls[0];
            expect(embeddings).toHaveLength(32);
        });
    });

    // -----------------------------------------------------------------------
    describe('runTraining()', () => {

        const trainingRows = [
            makeRow(2, 'junior', ['Node.js', 'TypeScript'], ['AWS', 'Docker']),
            makeRow(8, 'senior', ['Python'],                ['GCP']),
        ];

        // Mock model que simula fit/save sem executar treino real
        const makeMockModel = () => ({
            fit:     jest.fn().mockResolvedValue({}),
            save:    jest.fn().mockResolvedValue({}),
            dispose: jest.fn(),
        });

        beforeEach(() => {
            repository.getRawTrainingData.mockResolvedValue(trainingRows);
            (fs.existsSync   as jest.Mock).mockReturnValue(false);
            (fs.mkdirSync    as jest.Mock).mockReturnValue(undefined);
            (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);
            jest.spyOn(service, 'buildModel').mockReturnValue(makeMockModel() as any);
            jest.spyOn(service, 'syncDatabaseEmbeddings').mockResolvedValue(undefined);
        });

        afterEach(() => {
            jest.restoreAllMocks();
            // Restaura o pass-through do existsSync para não quebrar outros testes
            (fs.existsSync as jest.Mock).mockImplementation(
                jest.requireActual<typeof import('fs')>('fs').existsSync
            );
            (fs.mkdirSync    as jest.Mock).mockReset();
            (fs.writeFileSync as jest.Mock).mockReset();
        });

        it('busca os dados de treinamento via getRawTrainingData', async () => {
            await service.runTraining();

            expect(repository.getRawTrainingData).toHaveBeenCalledTimes(1);
        });

        it('constrói o vocabulário com os dados retornados pelo banco', async () => {
            const buildSpy = jest.spyOn(vocabularyService, 'build');

            await service.runTraining();

            expect(buildSpy).toHaveBeenCalledTimes(1);
            expect(buildSpy).toHaveBeenCalledWith(trainingRows);
        });

        it('constrói o modelo com vocabularySize e seniorityCount derivados dos dados', async () => {
            await service.runTraining();

            // 2 senioridades (junior, senior) no dataset
            expect(service.buildModel).toHaveBeenCalledWith(
                expect.any(Number),
                2
            );
        });

        it('cria o diretório model-data quando ainda não existe', async () => {
            (fs.existsSync as jest.Mock).mockReturnValue(false);

            await service.runTraining();

            expect(fs.mkdirSync).toHaveBeenCalledWith('./model-data');
        });

        it('não tenta criar o diretório quando ele já existe', async () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);

            await service.runTraining();

            expect(fs.mkdirSync).not.toHaveBeenCalled();
        });

        it('salva metadata.json com seniorityList, vocabSize e mapeamento do vocabulário', async () => {
            await service.runTraining();

            expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
            const [path, content] = (fs.writeFileSync as jest.Mock).mock.calls[0];
            expect(path).toBe('./model-data/metadata.json');

            const parsed = JSON.parse(content as string);
            expect(parsed).toHaveProperty('seniorityList');
            expect(parsed).toHaveProperty('vocabSize');
            expect(parsed).toHaveProperty('vocab');
            expect(Array.isArray(parsed.seniorityList)).toBe(true);
        });

        it('chama model.save com o caminho correto', async () => {
            const mockModel = makeMockModel();
            (service.buildModel as jest.Mock).mockReturnValue(mockModel);

            await service.runTraining();

            expect(mockModel.save).toHaveBeenCalledWith('file://./model-data');
        });

        it('chama syncDatabaseEmbeddings com o modelo treinado', async () => {
            const mockModel = makeMockModel();
            (service.buildModel as jest.Mock).mockReturnValue(mockModel);

            await service.runTraining();

            expect(service.syncDatabaseEmbeddings).toHaveBeenCalledWith(mockModel);
        });

        it('propaga erro quando getRawTrainingData falha', async () => {
            repository.getRawTrainingData.mockRejectedValue(new Error('DB connection refused'));

            await expect(service.runTraining()).rejects.toThrow('DB connection refused');
        });

        it('loga progresso apenas nas épocas múltiplas de 10 via onEpochEnd', async () => {
            const mockModel = makeMockModel();
            (service.buildModel as jest.Mock).mockReturnValue(mockModel);

            await service.runTraining();

            // Captura o callback passado para model.fit e o invoca diretamente
            const fitCall = (mockModel.fit as jest.Mock).mock.calls[0];
            const { onEpochEnd } = fitCall[2].callbacks;

            const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

            onEpochEnd(0,  { loss: 0.5, accuracy: 0.8  }); // múltiplo de 10 → loga
            onEpochEnd(5,  { loss: 0.4, accuracy: 0.85 }); // não múltiplo → silencioso
            onEpochEnd(10, { loss: 0.3, accuracy: 0.9  }); // múltiplo de 10 → loga
            onEpochEnd(15, { loss: 0.2, accuracy: 0.95 }); // não múltiplo → silencioso

            expect(consoleSpy).toHaveBeenCalledTimes(2);
            consoleSpy.mockRestore();
        });
    });
});
