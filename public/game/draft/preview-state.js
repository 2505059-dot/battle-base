// Draft Workbench v1 — Local Pick & Slot Placement Preview State
// Enforces the 3-step flow: Select Candidate -> Preview & Select Legal Slot -> Final Confirm Pick.
// Strictly uses existing rules.js legality helpers without relaxing any Draft constraints.

import { ROLES, SLOTS, getSlotRole, getSlotsForRole } from '../shared/constants.js';
import { canTeamPick } from '../state.js';
import {
    canPlayerFitSlot,
    getAvailableRolesForPlayer,
    getAvailableSlotsForPlayer,
    getFirstAvailableSlotForRole,
    isPlayerEntityInRoster,
} from './rules.js';

export const MOBILE_TABS = Object.freeze(['candidates', 'squad', 'inspector']);

export function createDraftPreviewState() {
    return {
        selectedPlayerId: null,
        selectedSlot: null,
        inspectedSlot: null,
        mobileTab: 'candidates',
        pendingPickKey: null,
        lastRollId: null,
    };
}

export function clearDraftPreview(preview) {
    if (!preview) return;
    preview.selectedPlayerId = null;
    preview.selectedSlot = null;
    preview.inspectedSlot = null;
    preview.pendingPickKey = null;
}

export function getSelectedCandidate(myTeam, preview) {
    const playerId = preview?.selectedPlayerId;
    if (!playerId || !myTeam?.draft?.currentRoll?.players) return null;
    return myTeam.draft.currentRoll.players.find((p) => p.id === playerId) ?? null;
}

export function getInspectedRosterEntry(myTeam, preview) {
    if (!myTeam?.roster || !preview?.inspectedSlot || preview?.selectedPlayerId) return null;
    const slot = preview.inspectedSlot;
    if (!SLOTS.includes(slot)) return null;
    const player = myTeam.roster[slot] ?? null;
    if (!player) return null;
    return { slot, player };
}

export function selectInspectedSlot(state, myTeam, preview, slot) {
    if (!preview || !state || state.phase !== 'DRAFT' || !myTeam?.roster) {
        return { changed: false, reason: 'inactive_phase' };
    }
    if (preview.selectedPlayerId) {
        return { changed: false, reason: 'candidate_active' };
    }
    if (!SLOTS.includes(slot) || !myTeam.roster[slot]) {
        return { changed: false, reason: 'empty_slot' };
    }
    preview.inspectedSlot = preview.inspectedSlot === slot ? null : slot;
    return {
        changed: true,
        inspectedSlot: preview.inspectedSlot,
        player: myTeam.roster[slot],
    };
}

export function isLegalCandidateSlot(teamOrRoster, candidate, slot) {
    const roster = teamOrRoster?.roster ?? teamOrRoster;
    if (!roster || !candidate || !SLOTS.includes(slot)) return false;
    if (roster[slot] !== null) return false;
    if (isPlayerEntityInRoster(roster, candidate)) return false;
    return canPlayerFitSlot(candidate, slot);
}

export function getSlotPreviewState(myTeam, candidate, slot, selectedSlot) {
    if (!myTeam || !SLOTS.includes(slot)) return 'empty';
    if (myTeam.roster[slot] !== null) return 'occupied';
    if (!candidate) return 'empty';
    if (isLegalCandidateSlot(myTeam.roster, candidate, slot)) {
        return selectedSlot === slot ? 'preview' : 'eligible';
    }
    return 'mismatch';
}

export function reconcileDraftPreview(state, myTeam, preview) {
    if (!preview) return;

    const currentRollId = myTeam?.draft?.currentRoll?.id ?? null;
    if (preview.lastRollId !== currentRollId) {
        clearDraftPreview(preview);
        preview.lastRollId = currentRollId;
    }

    if (
        preview.inspectedSlot &&
        (!state || state.phase !== 'DRAFT' || !myTeam?.roster?.[preview.inspectedSlot])
    ) {
        preview.inspectedSlot = null;
    }

    if (
        !state ||
        state.phase !== 'DRAFT' ||
        !myTeam ||
        myTeam.draft?.locked ||
        myTeam.draft?.phase !== 'PICK' ||
        !myTeam.draft?.currentRoll
    ) {
        preview.selectedPlayerId = null;
        preview.selectedSlot = null;
        preview.pendingPickKey = null;
        return;
    }

    if (preview.selectedPlayerId) {
        preview.inspectedSlot = null;
        const candidate = getSelectedCandidate(myTeam, preview);
        if (
            !candidate ||
            isPlayerEntityInRoster(myTeam.roster, candidate) ||
            getAvailableRolesForPlayer(myTeam.roster, candidate).length === 0
        ) {
            clearDraftPreview(preview);
            return;
        }

        if (preview.selectedSlot && !isLegalCandidateSlot(myTeam.roster, candidate, preview.selectedSlot)) {
            preview.selectedSlot = null;
            preview.pendingPickKey = null;
        }
    } else if (preview.selectedSlot) {
        preview.selectedSlot = null;
        preview.pendingPickKey = null;
    }
}

export function selectPreviewCandidate(state, myTeam, preview, playerId) {
    if (!preview || !state || state.phase !== 'DRAFT' || !canTeamPick(myTeam)) {
        return { changed: false, reason: 'inactive_phase' };
    }

    const candidate = myTeam.draft?.currentRoll?.players?.find((p) => p.id === playerId) ?? null;
    if (!candidate) {
        return { changed: false, reason: 'missing_candidate' };
    }

    if (
        isPlayerEntityInRoster(myTeam.roster, candidate) ||
        getAvailableRolesForPlayer(myTeam.roster, candidate).length === 0
    ) {
        return { changed: false, reason: 'illegal_candidate' };
    }

    preview.selectedPlayerId = candidate.id;
    preview.inspectedSlot = null;
    preview.pendingPickKey = null;

    // Re-validate previously previewed slot against the newly selected candidate; clear if invalid
    if (preview.selectedSlot && !isLegalCandidateSlot(myTeam.roster, candidate, preview.selectedSlot)) {
        preview.selectedSlot = null;
    }

    return {
        changed: true,
        candidate,
        selectedSlot: preview.selectedSlot,
    };
}

export function selectPreviewSlot(state, myTeam, preview, slotOrRole) {
    if (!preview || !state || state.phase !== 'DRAFT' || !canTeamPick(myTeam)) {
        return { changed: false, reason: 'inactive_phase' };
    }

    const candidate = getSelectedCandidate(myTeam, preview);
    if (!candidate) {
        return { changed: false, reason: 'need_player' };
    }

    let targetSlot = null;
    if (SLOTS.includes(slotOrRole)) {
        targetSlot = slotOrRole;
    } else if (ROLES.includes(slotOrRole)) {
        const openRoleSlots = getSlotsForRole(slotOrRole).filter((s) => myTeam.roster[s] === null);
        if (openRoleSlots.length > 0 && preview.selectedSlot && getSlotRole(preview.selectedSlot) === slotOrRole) {
            const curIdx = openRoleSlots.indexOf(preview.selectedSlot);
            targetSlot = openRoleSlots[(curIdx + 1) % openRoleSlots.length];
        } else {
            targetSlot = getFirstAvailableSlotForRole(myTeam.roster, slotOrRole);
        }
    }

    if (!targetSlot) {
        return { changed: false, reason: 'no_slot' };
    }

    if (myTeam.roster[targetSlot] !== null) {
        return { changed: false, reason: 'slot_occupied' };
    }

    if (!isLegalCandidateSlot(myTeam.roster, candidate, targetSlot)) {
        return { changed: false, reason: 'slot_mismatch' };
    }

    preview.selectedSlot = targetSlot;
    preview.pendingPickKey = null;

    return {
        changed: true,
        candidate,
        selectedSlot: targetSlot,
    };
}

export function getConfirmPickStatus(state, myTeam, preview) {
    if (preview?.pendingPickKey) {
        return {
            canConfirm: false,
            reasonKey: 'draft.confirmReasonSubmitting',
            candidate: null,
            slot: null,
        };
    }

    if (!state || state.phase !== 'DRAFT' || !canTeamPick(myTeam)) {
        return {
            canConfirm: false,
            reasonKey: 'draft.confirmReasonNeedPlayer',
            candidate: null,
            slot: null,
        };
    }

    const candidate = getSelectedCandidate(myTeam, preview);
    if (!candidate) {
        return {
            canConfirm: false,
            reasonKey: 'draft.confirmReasonNeedPlayer',
            candidate: null,
            slot: null,
        };
    }

    if (isPlayerEntityInRoster(myTeam.roster, candidate)) {
        return {
            canConfirm: false,
            reasonKey: 'draft.duplicatePlayer',
            candidate,
            slot: null,
        };
    }

    const availableSlots = getAvailableSlotsForPlayer(myTeam.roster, candidate);
    if (availableSlots.length === 0) {
        return {
            canConfirm: false,
            reasonKey: 'draft.noAvailableSlot',
            candidate,
            slot: null,
        };
    }

    const slot = preview?.selectedSlot ?? null;
    if (!slot) {
        return {
            canConfirm: false,
            reasonKey: 'draft.confirmReasonNeedSlot',
            candidate,
            slot: null,
        };
    }

    if (myTeam.roster[slot] !== null) {
        return {
            canConfirm: false,
            reasonKey: 'draft.confirmReasonSlotOccupied',
            candidate,
            slot,
        };
    }

    if (!isLegalCandidateSlot(myTeam.roster, candidate, slot)) {
        return {
            canConfirm: false,
            reasonKey: 'draft.confirmReasonSlotMismatch',
            candidate,
            slot,
        };
    }

    return {
        canConfirm: true,
        reasonKey: null,
        candidate,
        slot,
    };
}
