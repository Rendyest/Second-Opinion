import { useSyncExternalStore } from 'react';
import type { GateReason } from '../contracts';
import type { BoneBaseline } from './gate';

export type LivePipelineStatus = 'idle' | 'loading' | 'live' | 'denied' | 'error';

/** Pipeline status only — no joints, angles, or frame data pass through here. */
export interface LiveStats {
  status: LivePipelineStatus;
  fps: number;
}

let stats: LiveStats = { status: 'idle', fps: 0 };
const listeners = new Set<() => void>();

export function publishLiveStats(next: LiveStats): void {
  if (next.status === stats.status && next.fps === stats.fps) return;
  stats = { status: next.status, fps: next.fps };
  for (const fn of listeners) fn();
}

function getSnapshot(): LiveStats {
  return stats;
}

export function subscribeLiveStats(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * For reviewer routes (e.g. /metrics). Never used on participant routes.
 * getSnapshot doubles as the server snapshot so reviewer pages can also
 * render via renderToStaticMarkup; it only ever reflects pipeline status.
 */
export function useLiveStats(): LiveStats {
  return useSyncExternalStore(subscribeLiveStats, getSnapshot, getSnapshot);
}

export interface GateJointVisibility {
  label: string;
  conf: number | null;
  visible: boolean;
}

export interface GateBoneDetails {
  /** Scale-corrected ratio for the current frame (needs a baseline). */
  ratio: number | null;
  /** Median ratio over recent frames (needs a baseline). */
  smoothedRatio: number | null;
  /** Scale-invariant length for the current frame. */
  normLen: number | null;
  /** Median of the stored norm history. */
  historyMedian: number | null;
  /** Fractional jump of normLen versus the history median. */
  jumpFraction: number | null;
}

/** Latest gate computation for the dev panel on /metrics. Never persisted. */
export interface GateDetails {
  hasBaseline: boolean;
  baseline: BoneBaseline | null;
  visMin: number;
  foreshorteningMin: number;
  boneLengthTol: number;
  joints: GateJointVisibility[];
  scale: number | null;
  upperArm: GateBoneDetails;
  forearm: GateBoneDetails;
  reasons: GateReason[];
}

let gateDetails: GateDetails | null = null;
const gateListeners = new Set<() => void>();

/** Publish the latest gate computation (dev only). Cleared when the camera stops. */
export function publishGateDetails(next: GateDetails | null): void {
  gateDetails = next;
  for (const fn of gateListeners) fn();
}

function getGateSnapshot(): GateDetails | null {
  return gateDetails;
}

export function subscribeGateDetails(fn: () => void): () => void {
  gateListeners.add(fn);
  return () => {
    gateListeners.delete(fn);
  };
}

/**
 * For the reviewer dev panel (e.g. /metrics). Never used on participant
 * routes. getGateSnapshot doubles as the server snapshot so reviewer pages
 * can also render via renderToStaticMarkup.
 */
export function useGateDetails(): GateDetails | null {
  return useSyncExternalStore(subscribeGateDetails, getGateSnapshot, getGateSnapshot);
}

/** Latest reach-and-hold detector readout for the dev panel on /metrics. */
export interface ReachDetails {
  /** Unsmoothed nearest-point hand distance, in shoulder widths. */
  rawDist: number | null;
  /** Smoothed nearest-point hand distance, in shoulder widths. */
  smoothDist: number | null;
  zoneRadius: number;
  /** Shoulder rise versus the rest median, in shoulder widths. */
  rise: number | null;
  phase: string;
  topSignal: string | null;
}

let reachDetails: ReachDetails | null = null;
const reachListeners = new Set<() => void>();

/** Publish the latest reach readout (dev only). Cleared with the detector. */
export function publishReachDetails(next: ReachDetails | null): void {
  reachDetails = next;
  for (const fn of reachListeners) fn();
}

function getReachSnapshot(): ReachDetails | null {
  return reachDetails;
}

export function subscribeReachDetails(fn: () => void): () => void {
  reachListeners.add(fn);
  return () => {
    reachListeners.delete(fn);
  };
}

/**
 * For the reviewer dev panel (e.g. /metrics). Never used on participant
 * routes. getReachSnapshot doubles as the server snapshot so reviewer pages
 * can also render via renderToStaticMarkup.
 */
export function useReachDetails(): ReachDetails | null {
  return useSyncExternalStore(subscribeReachDetails, getReachSnapshot, getReachSnapshot);
}
