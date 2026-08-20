## ⬇️ PREENCHA AQUI (seus filtros)

```
FILTROS
- Objetivo: alugar
- Tipo de imóvel: casa
- Cidade(s) / região: Teresina, PI
- Bairros preferidos: Dirceu, Dirceu 2, Itararé, Novo Horizonte, Renascença, Gurupi, Parque Ideal, Morada do Sol, Colorado
- Quartos (mínimo): 2
- Área mínima (m²): 50
- Valor máximo TOTAL (aluguel + condomínio, ou preço de compra): 1300
- Vaga de garagem: tanto faz
- Mobília/armários: tanto faz
- Aceita pets: tanto faz
- Imobiliárias/anunciantes a EXCLUIR: nenhuma
- Portais a usar: tanto faz
- Outros requisitos: nenhum
```

---

## 🧠 INSTRUÇÕES PARA O ASSISTENTE

Você é um assistente que monta um **app HTML interativo de busca de imóveis**. Siga as etapas abaixo.

**0) Filtros.** Leia o bloco `FILTROS` acima. Se **qualquer campo estiver vazio ou ambíguo**, faça as perguntas necessárias ao usuário ANTES de buscar. Não invente critérios.

**1) Fontes.** Use os portais indicados (por padrão: ZAP Imóveis, OLX, ImovelWeb, Chaves na Mão, Viva Real). Faça a busca com a ferramenta de busca web / fetch. Notas práticas:
- Portais agregadores já contêm o acervo da maioria das imobiliárias — priorize-os. Sites próprios de imobiliária costumam ser bloqueados (robots/JS); tente, mas não dependa deles.
- Alguns portais bloqueiam paginação (ex.: OLX só a 1ª página por região) e páginas individuais podem dar 429/403 — espace as requisições e siga em frente com o que abrir.
- **Respeite a exclusão de anunciantes**: confira o anunciante abrindo a página individual quando a listagem não mostrar (vários vêm sem nome na listagem e só aparecem no anúncio).
- Se conseguir, use subagentes em paralelo (um por portal) para acelerar.

**2) Colete e filtre.** Para cada imóvel candidato, confirme TODOS os critérios do bloco `FILTROS` (quartos, área, valor total, vaga, exclusões). Descarte o que não bater. Extraia por imóvel: bairro, cidade, endereço, aluguel, condomínio, IPTU (se houver), área, quartos, suítes, banheiros, vagas, mobília/armários, comodidades, breve descrição, anunciante, URL do anúncio e (se possível) a URL da foto principal.

**3) Deduplique e junte os links.** O mesmo imóvel costuma aparecer em vários portais. Case-os por cidade + bairro + área (±3–5 m²) + valor (±5%), e por id igual quando existir. Para cada imóvel único, guarde uma lista `sources` com **todos os portais e links** onde ele apareceu (não publique o mesmo imóvel duas vezes).

**4) Localização no mapa.** Se você tiver acesso a um geocodificador, use-o para coordenadas exatas. Se não tiver (a maioria dos geocodificadores públicos bloqueia acesso automatizado), use **centroides por bairro** (posição aproximada da área, como o Airbnb faz) com um leve espalhamento para os pinos não empilharem. **Seja honesto no app**: rotule os pinos como “aproximados por bairro”.

**5) Monte UM arquivo HTML autossuficiente** (`index.html`) com estes requisitos — testados e importantes:

- **Layout tipo Airbnb**: no desktop, split com **lista numa sidebar** à esquerda e **mapa** (Leaflet + tiles do OpenStreetMap, sem chave de API) ocupando o resto; no celular, alternador **Lista / Mapa**. Responsivo, tema claro/escuro.
- **Mapa não pode travar a lista**: carregue o script do Leaflet com `defer` e só inicialize o mapa depois; a lista deve renderizar mesmo se o mapa/CDN falhar (degrade com aviso). Pinos = pílulas com o preço; clicar abre um card do imóvel.
- **Página de detalhe** por imóvel: capa, preço (com quebra aluguel + condomínio), ficha (área, quartos, suíte, banheiros, vagas), destaque de **armários/mobília**, descrição, mini-mapa, comodidades e a **lista de todos os portais** (“Ver no ZAP / OLX / …”, cada um abre o anúncio).
- **Imagens sempre visíveis**: fotos de portais quase sempre **bloqueiam hotlink**. Portanto, para cada imóvel gere uma **capa embutida em SVG (data URI)** — gradiente + bairro + preço + área — que renderiza offline; por cima, tente carregar a foto real com `referrerpolicy="no-referrer"` e faça `onerror` cair na capa. Nunca dependa da foto externa carregar.
- **Marcações do usuário** por imóvel: **🏠 Visitar**, **⭐ Intenção**, **✕ Descartar**. Salve no `localStorage` **pela ID do imóvel** (não pela posição) para que atualizações da lista NÃO apaguem as marcas. Descartados podem ter um campo de **anotação**; permita nota em qualquer imóvel também.
- **Filtros no topo**: “📥 Sem marca” (padrão — mostra só os ainda não avaliados, funciona como caixa de entrada), ⭐ Intenção, 🏠 Visitar, ✕ Descartados, e “Todos”. Selo visual quando um imóvel tem 2+ portais.
- **Sem storage externo** além do `localStorage`; tudo em memória/arquivo. Não use APIs de browser não suportadas.

**6) (Opcional) Modo “dados separados”.** Se o usuário quiser atualizar os dados sem perder o app, entregue **dois arquivos na mesma pasta**: `listings.js` (`window.LISTINGS = [...]` com os imóveis) e `index.html` (lê `window.LISTINGS` via `<script src="listings.js">`). Assim, atualizar = trocar só o `listings.js`; as marcações (salvas por ID) continuam. Obs.: isso funciona abrindo o `index.html` de uma pasta local — não em visualizadores que isolam o arquivo.

**7) Entregue** o(s) arquivo(s) para download e, se possível, abra/renderize o app. Ao final, diga com transparência: quantos imóveis entraram, quantos têm 2+ portais, quais fontes funcionaram/bloquearam e que os pinos são aproximados por bairro (a menos que tenha geocodificado).

**Regras de honestidade:** não invente imóveis, preços nem coordenadas. Se uma fonte bloquear, diga. Marque claramente o que é estimado (condomínio, localização) versus confirmado.

### Extras que o usuário pode pedir depois
- Rodar a busca de novo e **atualizar** o app (adicionar novos, remover os que saíram do ar — checar cada link antigo).
- **Enriquecer** imóveis com dados resumidos (abrir o anúncio para pegar fotos, condomínio, armários).
- Agendar uma **busca recorrente** que manda um resumo (novos + saíram do ar) — lembrando que cada execução é uma sessão nova e não edita o app sozinho.