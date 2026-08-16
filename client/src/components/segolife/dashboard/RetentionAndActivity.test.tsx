/**
 * RetentionAndActivity.test.tsx — Fase 14, spec §15/§16/§40.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const { mockRetentionQuery, mockHeatmapQuery } = vi.hoisted(() => ({
  mockRetentionQuery: vi.fn(),
  mockHeatmapQuery: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: { dashboard: { getRetention: { useQuery: mockRetentionQuery }, getHeatmap: { useQuery: mockHeatmapQuery } } },
}));

import { RetentionAndActivity } from "./RetentionAndActivity";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const EMPTY_SERIES = { byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 })), byWeekday: Array.from({ length: 7 }, (_, weekday) => ({ weekday, label: "", count: 0 })), sampleSize: 0, truncated: false };

describe("RetentionAndActivity — retención", () => {
  it("sin Students activos -> estado vacío honesto", () => {
    mockRetentionQuery.mockReturnValue({ data: { activeStudents: 0, firstTimeInPeriod: 0, returningInPeriod: 0, returningRatePct: null, avgActiveDaysPerStudent: null, multiVenueStudents: 0 }, isLoading: false, error: null });
    mockHeatmapQuery.mockReturnValue({ data: { attendance: EMPTY_SERIES, commerce: EMPTY_SERIES }, isLoading: false, error: null });
    render(<RetentionAndActivity filters={{}} />);
    expect(screen.getByText(/Sin Students activos en este rango/)).toBeInTheDocument();
  });

  it("con actividad real, muestra recurrentes con el % real", () => {
    mockRetentionQuery.mockReturnValue({ data: { activeStudents: 100, firstTimeInPeriod: 30, returningInPeriod: 70, returningRatePct: 70, avgActiveDaysPerStudent: 2.5, multiVenueStudents: 12 }, isLoading: false, error: null });
    mockHeatmapQuery.mockReturnValue({ data: { attendance: EMPTY_SERIES, commerce: EMPTY_SERIES }, isLoading: false, error: null });
    render(<RetentionAndActivity filters={{}} />);
    expect(screen.getByText("70%")).toBeInTheDocument();
  });
});

describe("RetentionAndActivity — actividad por hora/día", () => {
  it("sin asistencias -> estado vacío honesto", () => {
    mockRetentionQuery.mockReturnValue({ data: { activeStudents: 0, firstTimeInPeriod: 0, returningInPeriod: 0, returningRatePct: null, avgActiveDaysPerStudent: null, multiVenueStudents: 0 }, isLoading: false, error: null });
    mockHeatmapQuery.mockReturnValue({ data: { attendance: EMPTY_SERIES, commerce: EMPTY_SERIES }, isLoading: false, error: null });
    render(<RetentionAndActivity filters={{}} />);
    expect(screen.getByText(/Sin asistencias en este rango/)).toBeInTheDocument();
  });

  it("con muestra real, muestra el tamaño de muestra real", () => {
    mockRetentionQuery.mockReturnValue({ data: { activeStudents: 0, firstTimeInPeriod: 0, returningInPeriod: 0, returningRatePct: null, avgActiveDaysPerStudent: null, multiVenueStudents: 0 }, isLoading: false, error: null });
    const series = { ...EMPTY_SERIES, sampleSize: 42 };
    mockHeatmapQuery.mockReturnValue({ data: { attendance: series, commerce: EMPTY_SERIES }, isLoading: false, error: null });
    render(<RetentionAndActivity filters={{}} />);
    expect(screen.getByText(/Basado en 42 asistencias/)).toBeInTheDocument();
  });

  it("muestra truncada -> lo indica honestamente", () => {
    mockRetentionQuery.mockReturnValue({ data: { activeStudents: 0, firstTimeInPeriod: 0, returningInPeriod: 0, returningRatePct: null, avgActiveDaysPerStudent: null, multiVenueStudents: 0 }, isLoading: false, error: null });
    const series = { ...EMPTY_SERIES, sampleSize: 5000, truncated: true };
    mockHeatmapQuery.mockReturnValue({ data: { attendance: series, commerce: EMPTY_SERIES }, isLoading: false, error: null });
    render(<RetentionAndActivity filters={{}} />);
    expect(screen.getByText(/muestra acotada/)).toBeInTheDocument();
  });
});
