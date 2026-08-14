/**
 * useUrlParam.test.ts — deep navigation (Production Polish Gate spec §72):
 * un query param sincronizado con la URL real — shareable/reload-safe/
 * back-button-safe.
 */
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useUrlParam } from "./useUrlParam";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("useUrlParam", () => {
  it("lee el valor inicial desde la URL real", () => {
    window.history.replaceState({}, "", "/admin/students?segment=at_risk");
    const { result } = renderHook(() => useUrlParam("segment"));
    expect(result.current[0]).toBe("at_risk");
  });

  it("sin el param en la URL -> null", () => {
    window.history.replaceState({}, "", "/admin/students");
    const { result } = renderHook(() => useUrlParam("segment"));
    expect(result.current[0]).toBeNull();
  });

  it("al fijar un valor, la URL real se actualiza (shareable)", () => {
    window.history.replaceState({}, "", "/admin/students");
    const { result } = renderHook(() => useUrlParam("segment"));
    act(() => result.current[1]("dormant"));
    expect(window.location.search).toContain("segment=dormant");
  });

  it("al fijar null, el param se elimina de la URL (nunca deja basura tipo '?segment=')", () => {
    window.history.replaceState({}, "", "/admin/students?segment=dormant");
    const { result } = renderHook(() => useUrlParam("segment"));
    act(() => result.current[1](null));
    expect(window.location.search).not.toContain("segment");
  });

  it("preserva OTROS query params ya presentes al fijar el propio", () => {
    window.history.replaceState({}, "", "/admin/students/historical?crossVenueOnly=true");
    const { result } = renderHook(() => useUrlParam("status"));
    act(() => result.current[1]("LINKED"));
    expect(window.location.search).toContain("crossVenueOnly=true");
    expect(window.location.search).toContain("status=LINKED");
  });
});
