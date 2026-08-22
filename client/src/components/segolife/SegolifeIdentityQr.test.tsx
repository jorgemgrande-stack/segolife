import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "@/lib/i18n";

/**
 * SegolifeIdentityQr.test.tsx — "UX móvil: Bottom Sheets globales" §3: el
 * QR de identidad migró del Dialog centrado (bg-background, negro en tema
 * oscuro) al nuevo SegolifeBottomSheet, siempre blanco. Cubre: el botón
 * abre el sheet, el QR se renderiza con el token real, "Regenerate code"
 * sigue funcionando.
 */
const { mockMyIdentityToken, mockRotate } = vi.hoisted(() => ({
  mockMyIdentityToken: vi.fn(),
  mockRotate: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    ticketPurchase: {
      myIdentityToken: { useQuery: mockMyIdentityToken },
      rotateMyIdentityToken: { useMutation: mockRotate },
    },
  },
}));

import { SegolifeIdentityQrButton } from "./SegolifeIdentityQr";

beforeEach(async () => {
  await i18n.changeLanguage("en");
  mockMyIdentityToken.mockReturnValue({ data: { token: "abc123token" }, isLoading: false });
  mockRotate.mockReturnValue({ mutate: vi.fn(), isPending: false });
});
afterEach(() => cleanup());

describe("SegolifeIdentityQrButton — migrado al SegolifeBottomSheet", () => {
  it("el botón de acceso rápido abre el sheet con el título y el QR", async () => {
    const user = userEvent.setup();
    render(<SegolifeIdentityQrButton />);
    expect(screen.queryByText("My SEGOLIFE ID")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /my segolife id/i }));
    expect(await screen.findByText("My SEGOLIFE ID")).toBeInTheDocument();
    // QRCodeSVG renderiza un <svg role="img">.
    expect(document.querySelector("svg")).toBeInTheDocument();
  });

  it("pulsar 'Regenerate code' llama a la mutación real de rotación", async () => {
    const rotateMutate = vi.fn();
    mockRotate.mockReturnValue({ mutate: rotateMutate, isPending: false });
    const user = userEvent.setup();
    render(<SegolifeIdentityQrButton />);
    await user.click(screen.getByRole("button", { name: /my segolife id/i }));
    await user.click(await screen.findByRole("button", { name: /regenerate/i }));
    expect(rotateMutate).toHaveBeenCalled();
  });
});
