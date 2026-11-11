# Construtor Treehouse

Site onde clientes, promotores e comerciais da Jular montam uma casa Treehouse a partir dos módulos, em planta 2D ou em 3D, e pedem orçamento.

Começou como protótipo (um só ficheiro HTML). Este repositório é o MVP.

## Correr localmente

```bash
npm install
npm run dev        # site em http://localhost:5173 (sem envio de pedidos)
npm test           # regras de portas, pisos, desfazer e pedido
npm run build      # verificação de tipos + build de produção em dist/
```

Para testar o envio de pedidos localmente use `npx vercel dev` com as variáveis de `.env.example` preenchidas.

## Estrutura

| Pasta | O que tem |
| --- | --- |
| `src/model/` | Regras sem interface, com testes: catálogo de módulos, portas automáticas, avisos (sobreposição, módulos no ar, escadas), desfazer, validação da planta, email do pedido. |
| `src/ui/` | Vista 3D (three.js + peças do Blender), desenhos dos móveis na planta, formulário do pedido. |
| `src/main.ts` | Planta 2D, arrastar e largar, seleção, ligação entre tudo. |
| `api/quote.ts` | Função serverless (Vercel) que valida o pedido e o envia por email via Resend. |
| `public/kit/` | Peças modeladas no Blender (`kit.glb`: janelas, porta de entrada, portas de correr) e texturas de revestimento e deck. |
| `blender/` | Scripts Blender que geram o kit (`kit.py`), as texturas (`bake.py`) e o render de revisão (`review.py`). |

Unidades: a planta está em decímetros (1 = 10 cm); a cena 3D em metros.

## Regras atuais

- Divisão com divisão: porta. Divisão com deck: porta de correr em vidro. Deck com deck: sem porta. Sala com cozinha: espaço aberto.
- Até 3 pisos. Um módulo de cima tem de assentar em divisões (não em deck) e o piso de baixo precisa de escadas.
- Pedido de orçamento: só nome e email obrigatórios, telefone opcional, consentimento RGPD. Um consultor faz o resto.

## Pendente

- **Medidas reais dos módulos** (a Jular). As de `src/model/catalog.ts` são estimadas a partir da planta da Riga T2.
- **Validação da Jular** antes de publicar (medidas e uso da marca).
- Domínio de envio verificado no Resend e email comercial da Jular em `QUOTE_TO`.
- Limite de pedidos por IP na função de envio.
- Carregar o 3D só quando é aberto (hoje vai tudo no bundle inicial).

## Publicar (Vercel)

1. Importar o repositório na Vercel (deteta o Vite e a pasta `api/` sozinha).
2. Em *Settings → Environment Variables*, definir `RESEND_API_KEY`, `QUOTE_TO` e, quando houver domínio verificado, `QUOTE_FROM`.
