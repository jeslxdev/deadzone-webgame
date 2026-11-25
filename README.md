# ZONA MORTA

RPG de sobrevivência zumbi com loot, jogado no navegador. Câmera de cima, inclinada, no estilo League of Legends. Feito com Three.js, sem etapa de build.

## Como rodar

```powershell
node server.js
```

Depois abra http://localhost:5173. Precisa de internet porque o Three.js e as fontes vêm de CDN.
Também funciona em qualquer servidor estático, como o Laragon: basta copiar a pasta para `www`.

## Ciclo de jogo

1. **Criar o personagem.** O visual é editável: pele, cabelo, barba, olhos, roupas, acessórios, porte físico e altura. A classe é **Atirador** ou **Samurai**.
2. **Acampamento (hub).** Aqui você escolhe o mapa, distribui pontos de atributo, cuida do arsenal (equipar e vender) e usa o mercado.
3. **Mundo livre.** Saqueie caixas, carros, armários, caçambas, caixas militares e cofres segurando **E**. Mate zumbis e destrua os **ninhos**.
4. Enquanto houver ninhos vivos, a **Colmeia Mãe** fica protegida por um escudo. O **Boss** do mapa a guarda.
5. Se a Colmeia Mãe for destruída e o Boss morrer, o mapa vira **ZONA LIMPA**: os spawns param e aparece o Tesouro da Colmeia.
6. **Extração.** Volte ao caminhão no acampamento e segure E. Se morrer, você **perde a mochila**, mas mantém XP, nível e a arma equipada.

## Controles

| Tecla | Ação |
|---|---|
| WASD | Mover |
| Shift | Dash (invulnerável por um instante) |
| Espaço | Pular |
| Botão do meio / Shift + botão direito | Mover até o ponto (pathfinding) |
| Mouse + botão esquerdo | Mirar / atacar |
| Q / F | Habilidades da classe |
| R | Recarregar |
| E (segurar) | Saquear / extrair |
| 1 / 2 | Bandagem / Kit médico |
| Tab ou I | Mochila + atributos |
| Y / C / scroll | Travar câmera / centralizar / zoom |
| M / H / Esc | Som / ajuda / pausa |

## Conteúdo

- **Classes**
  - Atirador: Granada e Rajada Tática. Armas: pistola, SMG, escopeta, fuzil e rifle de precisão (este perfura alvos).
  - Samurai: Investida e Tempestade de Lâminas, com roubo de vida e armadura. Armas: katana, wakizashi dupla, facão, nodachi e naginata.
- **Raridades:** Comum, Incomum, Raro, Épico e Lendário. As lâminas brilham conforme a raridade.
- **Zumbis:** Andarilho, Corredor, Brutamontes, Cuspidor (ataque à distância), Inchado (explode) e Soldado Blindado (tem armadura).
- **Ranks:** Normal, Elite, Mini-Boss (um guardião por ninho) e Boss. As habilidades dos chefes mostram um aviso no chão antes: pancada em área, investida, invocar horda e rajada de ácido.
- **4 mapas procedurais**, cada um diferente a cada partida:
  - Centro Devastado
  - Subúrbio em Chamas
  - Porto Abandonado
  - Base Militar Caída
- **Atributos RPG:** Força, Agilidade, Vitalidade, Precisão e Sorte, com 3 pontos por nível.
- **Personagem portátil:** Personagem → Exportar gera um código `ZM1:...`, e Menu → Importar carrega esse código em outro navegador.

## Estrutura

```
index.html          entrada + importmap do Three.js
css/style.css       interface
js/data.js          BALANCEAMENTO: classes, armas, zumbis, mapas, loot, mercado
js/rpg.js           perfis (localStorage), XP, atributos, itens, loot
js/character.js     modelos low-poly (jogador, zumbis, armas)
js/world.js         gerador de mapas, colisão, grade de navegação (flow field)
js/zombies.js       IA dos zumbis e habilidades de chefes
js/player.js        movimento, combate e skills
js/game.js          loop da partida, câmera, projéteis, ninhos, spawns, extração
js/ui.js            HUD, minimapa, mochila, atributos
js/hub.js           acampamento   ·   js/menu.js  menu   ·   js/creator.js  editor
js/effects.js       partículas e avisos   ·   js/audio.js  sons sintetizados
```

## Modelos 3D do Meshy (opcional)

Os personagens são gerados pelo código em [js/character.js](js/character.js): anatomia com músculos, rosto, cabelo e roupas, tudo editável no criador.
Os zumbis e bosses também podem usar modelos `.glb` rigados e animados do Meshy:

1. Gere o modelo no Meshy (texto→3D), aplique rig e animações (idle, walk, run, attack, death) e exporte em **GLB**.
2. Coloque o arquivo em `models/` e registre em [models/manifest.json](models/manifest.json), por exemplo:
   ```json
   "zombie_andarilho": { "file": "andarilho.glb", "height": 1.8,
     "anims": { "idle": "Idle", "walk": "Walking", "run": "Running", "attack": "Attack", "death": "Dying" } }
   ```
   As chaves seguem o formato `zombie_<tipo>` ou `boss_<tipo>`.
3. Recarregue a página. Os tipos sem modelo continuam com o modelo procedural.

## Próximas etapas sugeridas

1. **Multiplayer / mundos de outros jogadores.** Servidor Node.js com WebSocket (por exemplo, Colyseus) e contas. O servidor passa a ser a autoridade sobre o personagem. Hoje o save fica no navegador e pode ser editado.
2. Modelos 3D reais (glTF) e animações no lugar dos blocos low-poly.
3. Áreas internas de prédios, ciclo dia/noite, clima.
4. Mais itens: armaduras, mods de arma, munição limitada, crafting no acampamento.
5. Árvore de talentos por classe e mais habilidades.

## Licença

Copyright (c) 2026 jeslxdev. Todos os direitos reservados. Veja [LICENSE](LICENSE): o código pode ser visualizado para estudo pessoal, mas cópia, modificação, distribuição, hospedagem ou uso comercial exigem autorização prévia e por escrito do autor. Componentes de terceiros (three.js, fontes, pacotes npm) seguem suas próprias licenças.
