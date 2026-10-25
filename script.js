socket.on('players', (players) => {
    // el servidor ya manda la lista ordenada de mayor a menor
    tbody.innerHTML = '';
    players.forEach((p, i) => {
        const tr = document.createElement('tr');

        const tdRank = document.createElement('td');
        tdRank.textContent = i + 1;

        const tdName = document.createElement('td');
        if (p.online) {
            const dot = document.createElement('span');
            dot.className = 'dot';
            dot.title = 'Conectado';
            tdName.appendChild(dot);
        }
        tdName.appendChild(document.createTextNode(p.name));

        const tdScore = document.createElement('td');
        tdScore.textContent = p.score;

        tr.append(tdRank, tdName, tdScore);
        if (myName && p.name === myName) tr.classList.add('me');
        tbody.appendChild(tr);
    });

    const mine = players.find((p) => p.name === myName);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'black';
    ctx.font = '32px Arial';
    ctx.fillText('Tu puntaje: ' + (mine ? mine.score : 0), 16, 40);
});