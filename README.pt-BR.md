# Real Estate Tracker

Prefer reading in English? [README.md](README.md)

Um rastreador de busca de imóveis conduzido por um agente de IA para programação: descreva o que você procura em filtros simples, e o agente busca em portais imobiliários, remove duplicatas entre eles e gera um único app HTML autossuficiente para navegar e marcar os resultados. Não é preso a nenhuma cidade específica — clone o repositório, edite os filtros e aponte para onde você estiver procurando imóvel.

Inspirado por [este gist](https://gist.github.com/brunobertolini/6c319951db004b8e1d9c4752afc7f6ba).

## Pré-requisitos

- [Claude Code](https://claude.com/product/claude-code) — o fluxo de busca é empacotado como uma [Skill](https://docs.claude.com/en/docs/claude-code/skills) do Claude Code (`.claude/skills/rest-tracker/`). É o que foi testado; adaptar para outro agente é possível, mas não foi verificado aqui.
- [Node.js](https://nodejs.org/) — roda os scripts de busca nos portais.
- `curl` disponível no seu `PATH` — os scripts chamam o curl para fazer as requisições HTTP de fato (veja "A skill" abaixo pra entender por quê).
- Um navegador pra abrir o HTML gerado. Não precisa de servidor, banco de dados nem chave de API pra nada disso.

## O que você vai ver

Rodar o rastreador gera um único arquivo HTML que você abre direto no navegador — sem instalar nada, sem servidor. Ele funciona como um pequeno site de anúncios estilo Airbnb:

- **Esquerda:** uma lista rolável de cards — um por imóvel, cada um com foto de capa, preço, endereço e dados rápidos (m², quartos, banheiros, vagas), mais um selo quando o mesmo imóvel aparece em 2+ portais.
- **Direita:** um mapa com um pino de preço por imóvel; clicar num pino ou card abre uma tela de detalhe com a descrição completa, comodidades, um mini-mapa e um link "ver no ZAP / OLX / ..." pra cada portal em que ele apareceu.
- Três marcações de um clique por imóvel — 🏠 Visitar / ⭐ Intenção / ✕ Descartar — mais anotações livres, salvas localmente no seu navegador, então rodar a busca de novo nunca apaga suas decisões.

## Como funciona

1. Clone este repositório e edite o bloco `FILTROS` em [`idea.md`](idea.md) — objetivo (alugar/comprar), tipo de imóvel, cidade/estado/bairros, quartos/área mínimos, valor total máximo, exclusões etc. Não há nada específico de Teresina no mecanismo em si; é só o que o `idea.md` deste repositório está configurado agora — mude a cidade/estado e o mesmo pipeline roda para onde você quiser.
2. Peça ao Claude Code para "regenerar" ou "atualizar" o rastreador.
3. Você recebe um novo `index-YYYY-MM-DD.html` — abra no navegador.

Rodar de novo nunca sobrescreve um `index-*.html` anterior; cada execução gera um novo arquivo com data.

O diagrama abaixo é o pipeline técnico por trás do passo 2 — útil se você quer entender os detalhes ou depurar algo, mas não é leitura necessária só pra usar o projeto.

```mermaid
flowchart TD
    A["idea.md<br/>bloco FILTROS"] --> B["skill rest-tracker"]
    B --> C1["fetch-grupozap.js<br/>--portal=zap"]
    B --> C2["fetch-grupozap.js<br/>--portal=vivareal"]
    B --> C3["fetch-olx.js"]
    B --> C4["fetch-imovelweb.js"]
    B --> C5["subagente<br/>(portais sem script,<br/>ex: Chaves na Mão)"]

    C1 --> D["Coleta de candidatos"]
    C2 --> D
    C3 --> D
    C4 --> D
    C5 --> D

    D --> E["Deduplica entre portais<br/>+ junta fontes"]
    E --> F["Atualiza registro de anunciantes<br/>(advertisers.json)"]
    E --> G["Renderiza index-YYYY-MM-DD.html"]

    F -.persiste entre execuções.-> F
    G --> H(["Abre no navegador<br/>lista + mapa, marcações em localStorage"])
```

## Arquivos

| Caminho | O que é |
|---|---|
| `idea.md` | Os critérios de filtro (bloco `FILTROS`) e a especificação original de busca/construção — é este arquivo que você edita para apontar o rastreador para sua própria cidade e preferências |
| `index-YYYY-MM-DD.html` | Saída gerada — navegador de imóveis autossuficiente (lista + mapa). Não é versionado por padrão; regenere quando precisar |
| `advertisers.json` | Registro persistente de anunciantes/imobiliárias vistos entre execuções — nome, telefone, site próprio se encontrado. Acumula ao longo do tempo, diferente das listagens |
| `.claude/skills/rest-tracker/` | A skill do Claude Code que conduz a regeneração — veja abaixo |

## O app (`index-*.html`)

- Layout estilo Airbnb: barra lateral com a lista + mapa Leaflet/OpenStreetMap (split no desktop, alternância no celular), tema claro/escuro
- Cada imóvel mostra todos os portais em que foi encontrado, com links para cada fonte
- Marque imóveis como **🏠 Visitar / ⭐ Intenção / ✕ Descartar**, com anotações — salvo no `localStorage` pela ID do imóvel, então regenerar os dados não apaga suas marcações
- Filtros no topo: sem marca (caixa de entrada, padrão), Intenção, Visitar, Descartados, Todos
- Capas são sempre geradas localmente (SVG) como alternativa; fotos reais dos portais são tentadas por cima e caem de volta para a capa gerada se bloquearem
- Os pinos do mapa usam as coordenadas do próprio anúncio quando disponíveis (ZAP/Viva Real/OLX fornecem todas); só recorre ao centroide aproximado do bairro quando uma fonte não fornece coordenadas — rotulado honestamente em ambos os casos

**Ressalva:** as marcações ficam vinculadas à origem `file://` do navegador. O Chrome compartilha uma única origem entre arquivos locais, então as marcações costumam persistir automaticamente no novo arquivo com data; o Firefox vincula por caminho de arquivo e não vai levá-las adiante.

## A skill (`.claude/skills/rest-tracker/`)

- [`SKILL.md`](.claude/skills/rest-tracker/SKILL.md) — o fluxo de regeneração: ler filtros → buscar nos portais → deduplicar → atualizar registro de anunciantes → renderizar → reportar
- [`REFERENCE.md`](.claude/skills/rest-tracker/REFERENCE.md) — schema dos campos de cada imóvel, regra de deduplicação, schema do registro de anunciantes e as receitas de extração de cada portal
- `scripts/` — buscadores determinísticos em Node para ZAP Imóveis, Viva Real, OLX e ImovelWeb (nenhum token de LLM gasto lendo HTML; portais sem script ainda caem para uma busca feita por um agente). Cada um chama o `curl` em vez do `fetch()` nativo do Node, já que esses portais bloqueiam a "impressão digital" do fetch do Node, mas não a do curl.

Portais cobertos atualmente: ZAP Imóveis, Viva Real, OLX, ImovelWeb (todos com script), Chaves na Mão (via agente, ainda sem script).

Você não precisa do agente pra testar os scripts — são ferramentas de linha de comando comuns que você pode rodar sozinho:

```
node .claude/skills/rest-tracker/scripts/fetch-olx.js \
  --neighborhoods="Renascença,Itararé" --uf=pi --city=teresina \
  --min-bedrooms=2 --min-area=50 --max-total=1300
```

Imprime o progresso no stderr e um array JSON com os imóveis que passaram nos filtros no stdout. Os quatro scripts seguem o mesmo padrão `--neighborhoods/--min-bedrooms/--min-area/--max-total` — veja o [REFERENCE.md](.claude/skills/rest-tracker/REFERENCE.md) pra lista completa de flags e schema de saída por portal.

## Regras de honestidade

Nunca inventados: imóveis, preços ou coordenadas. Tudo que é estimado (condomínio, precisão da localização) é rotulado como tal em vez de apresentado como confirmado. Se um portal bloquear o acesso, isso é reportado em vez de silenciosamente ignorado.

## Licença

[MIT](LICENSE) — use, faça fork, adapte pra sua própria cidade.
