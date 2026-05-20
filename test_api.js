const axios = require('axios');

console.log('Iniciando teste de API...');

async function test() {
    try {
        console.log('Enviando requisição...');
        const response = await axios.get('http://localhost:3001/buscar?keyword=padaria&lat=-23.550520&lng=-46.633308&originLat=-23.550520&originLng=-46.633308&mode=free');
        console.log('Status:', response.status);
        // console.log('Data:', JSON.stringify(response.data, null, 2));
        const results = Array.isArray(response.data) ? response.data : (response.data.results || []);
        console.log('Sucesso! Recebidos ' + results.length + ' resultados.');
    } catch (error) {
        if (error.response) {
            console.error('Erro na resposta do servidor:');
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else if (error.request) {
            console.error('Erro: Sem resposta do servidor (Servidor pode estar offline)');
        } else {
            console.error('Erro na requisição:', error.message);
        }
    }
}

test();
