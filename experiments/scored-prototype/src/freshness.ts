import { textDigest, type ObservationData } from './capture.ts';
/** Caller supplies current exact span; this helper performs no filesystem IO or mutation. */
export function compareSpan(observation: Pick<ObservationData, 'toolName' | 'digest' | 'partial' | 'outcome'>, currentText: string | undefined): 'fresh' | 'stale' | 'unknown' {
    if (currentText === undefined || observation.toolName !== 'read' || observation.partial || observation.outcome !== 'success')
        return 'unknown';
    return textDigest(currentText) === observation.digest ? 'fresh' : 'stale';
}
