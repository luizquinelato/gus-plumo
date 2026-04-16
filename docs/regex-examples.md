# Exemplos de Regex para Testes - Gus Expenses Platform

## 📚 Guia de Regex Complexos

### 1. **Pagamentos PIX com Chave Aleatória**
**Objetivo**: Capturar transações PIX que terminam com sequência de números/letras

**Regex**:
```regex
pix.*[a-z0-9]{8,}$
```

**Exemplos que capturam**:
- `pix enviado 1a2b3c4d5e6f`
- `transferencia pix abc123def456`
- `pix pagamento xyz789abc`

**Não captura**:
- `pix` (sem chave)
- `pix enviado` (sem sequência alfanumérica)

---

### 2. **Uber/99 com Identificador de Viagem**
**Objetivo**: Capturar corridas com asterisco e números

**Regex**:
```regex
(uber|99).*\*.*[0-9]{4}
```

**Exemplos que capturam**:
- `uber *viagem 1234`
- `99 taxi *corrida 5678`
- `uber eats *pedido 9012`

**Não captura**:
- `uber` (sem asterisco e números)
- `99 pop` (sem identificador)

---

### 3. **iFood com Código de Pedido**
**Objetivo**: Capturar pedidos iFood com padrões variados

**Regex**:
```regex
i?food.*(\*|pedido|ordem).*[0-9]{3,}
```

**Exemplos que capturam**:
- `ifood *restaurante 12345`
- `food pedido 678`
- `ifood ordem 999`

**Não captura**:
- `ifood` (sem código)
- `comida delivery` (não é ifood)

---

### 4. **Mercado Pago/Livre com Vendedor**
**Objetivo**: Capturar transações Mercado Pago/Livre

**Regex**:
```regex
merc(ado)?(pago|livre|p).*\*
```

**Exemplos que capturam**:
- `mercadopago *loja abc`
- `merclivre *vendedor xyz`
- `mercp *produto 123`
- `mercado livre *compra`

**Não captura**:
- `mercado` (sem pago/livre)
- `supermercado` (contexto diferente)

---

### 5. **Parcelamento (Parcela X/Y)**
**Objetivo**: Capturar transações parceladas

**Regex**:
```regex
parc(ela)?\.?\s*[0-9]{1,2}\s*/\s*[0-9]{1,2}
```

**Exemplos que capturam**:
- `compra parc 1/12`
- `parcela 03/10`
- `parc. 5 / 6`

**Não captura**:
- `parcelamento` (sem números)
- `parcela única`

---

### 6. **Assinaturas Mensais (Spotify, Netflix, etc)**
**Objetivo**: Capturar serviços de streaming/assinatura

**Regex**:
```regex
(spotify|netflix|amazon|prime|disney|hbo|youtube).*premium
```

**Exemplos que capturam**:
- `spotify premium`
- `netflix assinatura premium`
- `amazon prime video premium`

**Não captura**:
- `spotify` (sem premium)
- `música streaming` (não é serviço específico)

---

### 7. **Pagamentos com Valor Específico**
**Objetivo**: Capturar transações com valor em reais

**Regex**:
```regex
r\$\s*[0-9]{1,3}(,[0-9]{3})*\.[0-9]{2}
```

**Exemplos que capturam**:
- `pagamento r$ 150.00`
- `compra r$ 1,250.50`
- `débito r$ 25.99`

**Não captura**:
- `r$ 150` (sem centavos)
- `150.00` (sem R$)

---

### 8. **Datas no Final (DD/MM ou DD-MM)**
**Objetivo**: Capturar transações com data no final

**Regex**:
```regex
.*(0[1-9]|[12][0-9]|3[01])[-/](0[1-9]|1[0-2])$
```

**Exemplos que capturam**:
- `compra supermercado 15/03`
- `pagamento cartão 01-12`
- `transferência 31/01`

**Não captura**:
- `compra 15/03/2024` (tem ano)
- `15/03 compra` (data não está no final)

---

### 9. **Cancelamentos e Estornos**
**Objetivo**: Capturar transações de cancelamento

**Regex**:
```regex
^(cancelamento|estorno|reembolso|devolucao)
```

**Exemplos que capturam**:
- `cancelamento - uber`
- `estorno compra`
- `reembolso pedido`

**Não captura**:
- `compra cancelamento` (não começa com palavra-chave)
- `sem cancelamento` (não começa)

---

### 10. **Farmácias (Múltiplas Redes)**
**Objetivo**: Capturar diferentes redes de farmácia

**Regex**:
```regex
(droga|farma|drogaria|farmacia).*(raia|sao paulo|pacheco|araujo|popular)
```

**Exemplos que capturam**:
- `drogaria sao paulo`
- `farma raia drogasil`
- `drogaria pacheco`

**Não captura**:
- `farmácia` (sem rede específica)
- `drogaria local` (rede não listada)

---

## 🎯 Como Testar

1. Acesse a página **Curadoria**
2. Digite o regex na barra de busca
3. Sistema detecta automaticamente como "Modo: Regex"
4. Clique em "Reagrupar Todos"
5. Selecione tag/subtag
6. Marque "Mapear" para criar o mapeamento regex
7. Clique em "Salvar"

---

## 💡 Dicas

- Use `^` para início da string
- Use `$` para final da string
- Use `.*` para qualquer caractere (zero ou mais)
- Use `[0-9]{3,}` para 3 ou mais dígitos
- Use `(a|b|c)` para alternativas (a OU b OU c)
- Use `\*` para escapar caracteres especiais
- **Não use** `\d`, `\s`, `\w` (não suportados)
- **Não use** `\n` (apenas single line)

---

## ⚠️ Limitações

O sistema suporta apenas regex básico (comum entre JavaScript e Rust):
- ✅ Classes de caracteres: `[abc]`, `[a-z]`, `[^abc]`
- ✅ Quantificadores: `*`, `+`, `?`, `{n}`, `{n,m}`
- ✅ Alternação: `(a|b|c)`
- ✅ Âncoras: `^`, `$`
- ❌ Lookahead/lookbehind
- ❌ Backreferences
- ❌ Named groups
- ❌ Unicode escapes

