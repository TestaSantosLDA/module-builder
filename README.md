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
| `src/ui/` | Vista 3D (three.js + peças do Blender; carregada só quando se abre o 3D), sombras de contacto, desenhos dos móveis na planta, formulário do pedido. |
| `src/fx/` | Níveis de qualidade (`?fx=`) e pós-processamento (AgX + photo look, GTAO), iguais aos do passeio do apartamento. |
| `src/main.ts` | Planta 2D, arrastar e largar, seleção, ligação entre tudo. |
| `api/quote.ts` | Função serverless (Vercel) que valida o pedido e o envia por email via Resend. |
| `assets/` | Fontes dos assets (texturas JPG/PNG, céu, `kit.glb` do Blender) e `assets.json`, a lista de tudo o que o site usa, com origem e licença. |
| `public/kit/` | O que o site descarrega, gerado de `assets/`: texturas KTX2, `kit.glb` comprimido (meshopt), céu HDRI e `CREDITOS.md`. |
| `public/basis/` | Descodificador das texturas KTX2 (do three.js). |
| `blender/` | Scripts Blender que geram o kit (`kit.py`), as texturas (`bake.py`) e o render de revisão (`review.py`). |
| `scripts/` | `compress-assets.mjs` (assets → KTX2/meshopt), `prep_hdri.py` (HDRI da Poly Haven → luz + fundo + sol), `fetch_polyhaven.py` (descarrega o que está em `assets.json`; correr no PC). |

Unidades: a planta está em decímetros (1 = 10 cm); a cena 3D em metros.

## Aspeto 3D

- Luz por camadas, para qualquer combinação de módulos: céu HDRI (Poly Haven, CC0) com o sol desse céu a projetar sombras, AO dentro de cada módulo (pé da parede, cantos, ombreiras), sombras de contacto pintadas a partir da planta, GTAO só no nível `alto`, brilho interior por tipo de divisão.
- Níveis: telemóveis, tablets e ecrãs pequenos ficam no nível `leve` (sem composer, pixel ratio até 1,5, sombras 1024). O 3D só desenha quando alguma coisa muda.
- Para comparar: `?fx=0` (como era antes), `?fx=leve`, `?fx=alto`, `?fx=noao,nosky,nolook,nocontact`.
- Mudar ou acrescentar uma textura: pôr a fonte em `assets/`, registar em `assets/assets.json` e correr `node scripts/compress-assets.mjs`. Só CC0 ou trabalho próprio vai para o site.

## Regras atuais

- Divisão com divisão: porta. Divisão com deck: porta de correr em vidro. Deck com deck: sem porta. Sala com cozinha: espaço aberto.
- Até 3 pisos. Um módulo de cima tem de assentar em divisões (não em deck) e o piso de baixo precisa de escadas.
- Pedido de orçamento: só nome e email obrigatórios, telefone opcional, consentimento RGPD. Um consultor faz o resto.

## Pendente

- **Medidas reais dos módulos** (a Jular). As de `src/model/catalog.ts` são estimadas a partir da planta da Riga T2.
- **Validação da Jular** antes de publicar (medidas e uso da marca).
- Domínio de envio verificado no Resend e email comercial da Jular em `QUOTE_TO`.
- Limite de pedidos por IP na função de envio.

## Publicar (Vercel)

1. Importar o repositório na Vercel (deteta o Vite e a pasta `api/` sozinha).
2. Em *Settings → Environment Variables*, definir `RESEND_API_KEY`, `QUOTE_TO` e, quando houver domínio verificado, `QUOTE_FROM`.
