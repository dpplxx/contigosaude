import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Login } from "./Login";
import { entrar } from "../lib/api";

vi.mock("../lib/api", () => ({
  entrar: vi.fn(),
}));

describe("Login", () => {
  beforeEach(() => {
    entrar.mockReset();
  });

  it("renderiza os campos e o botão", () => {
    render(<Login />);
    expect(screen.getByPlaceholderText("voce@email.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Entrar/i })).toBeInTheDocument();
  });

  it("chama onEntrou com a sessão quando o login dá certo", async () => {
    const sessaoFake = { user: { id: "abc" } };
    entrar.mockResolvedValueOnce(sessaoFake);
    const onEntrou = vi.fn();

    render(<Login onEntrou={onEntrou} />);
    fireEvent.change(screen.getByPlaceholderText("voce@email.com"), {
      target: { value: "admin@contigosaude.com.br" },
    });
    fireEvent.change(document.querySelector('input[type="password"]'), {
      target: { value: "senha-correta" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Entrar/i }));

    await waitFor(() => expect(onEntrou).toHaveBeenCalledWith(sessaoFake));
    expect(entrar).toHaveBeenCalledWith("admin@contigosaude.com.br", "senha-correta");
  });

  it('traduz "Invalid login credentials" pra mensagem amigável', async () => {
    entrar.mockRejectedValueOnce(new Error("Invalid login credentials"));

    render(<Login />);
    fireEvent.change(screen.getByPlaceholderText("voce@email.com"), {
      target: { value: "admin@contigosaude.com.br" },
    });
    fireEvent.change(document.querySelector('input[type="password"]'), {
      target: { value: "senha-errada" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Entrar/i }));

    expect(await screen.findByText("Email ou senha incorretos.")).toBeInTheDocument();
  });

  it("mostra a mensagem original do erro quando não é credencial inválida", async () => {
    entrar.mockRejectedValueOnce(new Error("Failed to fetch"));

    render(<Login />);
    fireEvent.change(screen.getByPlaceholderText("voce@email.com"), {
      target: { value: "admin@contigosaude.com.br" },
    });
    fireEvent.change(document.querySelector('input[type="password"]'), {
      target: { value: "qualquer" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Entrar/i }));

    expect(await screen.findByText(/Sem conexão com o servidor/i)).toBeInTheDocument();
  });
});
