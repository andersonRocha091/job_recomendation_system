import * as tf from '@tensorflow/tfjs-node';
import * as fs from 'fs';
import { IModelStore, ModelState } from '@core/ports/out/IModelStore';
import { VocabularyService } from '@core/domain/training/services/VocabularyService';

export class InMemoryModelStore implements IModelStore {
    private state: ModelState | null = null;

    update(state: ModelState): void {
        this.state?.model.dispose();
        this.state = state;
    }

    async tryLoadFromDisk(modelPath: string): Promise<boolean> {
        const metaPath = `${modelPath}/metadata.json`;
        if (!fs.existsSync(metaPath)) return false;

        try {
            const raw = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            const model = await tf.loadLayersModel(`file://${modelPath}/model.json`);

            const vocabulary = new VocabularyService();
            vocabulary.restore(raw.vocab);

            this.state = {
                model,
                vocabulary,
                metadata: {
                    maxExperience: raw.maxExperience,
                    minExperience: raw.minExperience,
                    seniorityList: raw.seniorityList,
                    vocabSize:     raw.vocabSize,
                },
            };
            return true;
        } catch (err) {
            console.error('Falha ao carregar modelo do disco:', err);
            return false;
        }
    }

    getState(): ModelState | null {
        return this.state;
    }

    isReady(): boolean {
        return this.state !== null;
    }
}
