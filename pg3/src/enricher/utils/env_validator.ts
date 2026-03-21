
import { Logger } from './logger';
import { EnvValidationReport, validateRuntimeEnv } from '../../shared-runtime/config/runtime_env_validator';

export class EnvValidator {
    static validate(): EnvValidationReport {
        return validateRuntimeEnv(Logger);
    }
}
