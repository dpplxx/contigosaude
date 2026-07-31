# Testes Automatizados

Este projeto usa **Vitest** para testes unitários e **React Testing Library** para testes de componentes.

## Configuração

Os testes foram adicionados ao `package.json`:

```bash
npm test              # Rodar testes uma vez
npm run test:ui       # Abrir interface visual de testes
```

## Estrutura de Testes

Os testes estão na mesma pasta que os componentes, com extensão `.test.jsx`:

```
src/components/
  ├── BuscaFisios.jsx
  ├── BuscaFisios.test.jsx  ← Testes do componente
  ├── VerificacaoCREFITO.jsx
  └── VerificacaoCREFITO.test.jsx
```

## Testes Implementados

### ✅ BuscaFisios.test.jsx
- Renderiza o formulário inicial
- Desabilita o botão sem informações obrigatórias
- Exibe erro se campos faltarem

### Em desenvolvimento
- VerificacaoCREFITO
- Normalização de dados
- API de notificações
- Autenticação de pacientes

## Rodar testes localmente

```bash
# Instalar dependências de teste
npm install

# Rodar testes
npm test

# Com interface visual (Vitest UI)
npm run test:ui
```

## CI/CD

Os testes **não** rodam no GitHub Actions ainda. Para ativar:

1. Atualize `.github/workflows/deploy.yml`:

```yaml
- run: npm run lint
- run: npm test  # Adicione esta linha
```

2. Faça um `git push` para testar

Se os testes falharem, o deploy será bloqueado. ✅ Segurança garantida.

## Boas práticas

1. **Mock de dependências externas** - Supabase, APIs, etc não devem ser testadas
2. **Teste comportamento do usuário** - clicks, typing, não implementação
3. **Teste casos felizes e de erro** - ambos são importantes

## Recursos

- [Vitest Docs](https://vitest.dev)
- [React Testing Library](https://testing-library.com/react)
- [Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
