// Bot Persona definitions and resolution
// v1 ships with the neutral persona while providing the full orthogonal Persona interface
// for future coaches (Guardiola, Mourinho, Klopp, Forum Ultra, Data Nerd)

export const DEFAULT_PERSONA_ID = 'neutral';

export const NEUTRAL_PERSONA = Object.freeze({
    id: 'neutral',
    name: 'Neutral',
    roleWeights: Object.freeze({
        GK: 1.0,
        DF: 1.0,
        MF: 1.0,
        FW: 1.0,
    }),
    attributeMultipliers: Object.freeze({
        attack: 1.0,
        creation: 1.0,
        defense: 1.0,
        physical: 1.0,
        goalkeeping: 1.0,
        overall: 1.0,
    }),
    balancePreference: 1.0,
    riskPreference: 0.0,
    starPreference: 0.0,
});

export const BOT_PERSONAS = Object.freeze({
    neutral: NEUTRAL_PERSONA,
});

export function createPersona(definition = {}) {
    const id = typeof definition.id === 'string' && definition.id.trim() ? definition.id.trim() : 'custom';
    const name = typeof definition.name === 'string' && definition.name.trim() ? definition.name.trim() : id;

    return Object.freeze({
        id,
        name,
        roleWeights: Object.freeze({
            GK: Number(definition.roleWeights?.GK ?? 1.0),
            DF: Number(definition.roleWeights?.DF ?? 1.0),
            MF: Number(definition.roleWeights?.MF ?? 1.0),
            FW: Number(definition.roleWeights?.FW ?? 1.0),
        }),
        attributeMultipliers: Object.freeze({
            attack: Number(definition.attributeMultipliers?.attack ?? 1.0),
            creation: Number(definition.attributeMultipliers?.creation ?? 1.0),
            defense: Number(definition.attributeMultipliers?.defense ?? 1.0),
            physical: Number(definition.attributeMultipliers?.physical ?? 1.0),
            goalkeeping: Number(definition.attributeMultipliers?.goalkeeping ?? 1.0),
            overall: Number(definition.attributeMultipliers?.overall ?? 1.0),
        }),
        balancePreference: Number(definition.balancePreference ?? 1.0),
        riskPreference: Number(definition.riskPreference ?? 0.0),
        starPreference: Number(definition.starPreference ?? 0.0),
    });
}

export function resolvePersona(personaInput = DEFAULT_PERSONA_ID) {
    if (!personaInput || personaInput === 'neutral') {
        return NEUTRAL_PERSONA;
    }
    if (typeof personaInput === 'string') {
        return BOT_PERSONAS[personaInput] ?? NEUTRAL_PERSONA;
    }
    if (typeof personaInput === 'object') {
        if (personaInput === NEUTRAL_PERSONA) return NEUTRAL_PERSONA;
        if (personaInput.id === 'neutral' && !personaInput.roleWeights && !personaInput.attributeMultipliers) {
            return NEUTRAL_PERSONA;
        }
        return createPersona(personaInput);
    }
    return NEUTRAL_PERSONA;
}
