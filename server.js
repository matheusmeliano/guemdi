const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const dotenv = require('dotenv');

function loadEnv() {
    dotenv.config({ path: path.join(__dirname, '.env') });
    dotenv.config({ path: path.join(__dirname, '.env.local') });
}

loadEnv();

console.log('--- SERVER START ---');
console.log('GOOGLE_PLACES_API_KEY IS:', process.env.GOOGLE_PLACES_API_KEY ? 'SET' : 'NOT SET');

const app = express();
const PORT = process.env.PORT || 3000;

// Inicializar cliente Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
let supabase = null;

if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log("Supabase conectado com sucesso.");
} else {
    console.warn("Aviso: Supabase não configurado. O cache não funcionará.");
}

// Habilitar CORS para permitir requisições do frontend
app.use(cors());

// Servir arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Rota principal para buscar empresas
app.get('/buscar', async (req, res) => {
    loadEnv();
    
    try {
        const { lat, lng, keyword, pagetoken, originLat, originLng, mode } = req.query;

        // Validação básica dos parâmetros (pagetoken dispensa keyword)
        if (!pagetoken && (!lat || !lng || !keyword)) {
            return res.status(400).json({ error: 'Parâmetros lat, lng e keyword são obrigatórios para a primeira busca.' });
        }

        // Definir a origem para cálculo de distância
        // A regra é estrita: a origem DEVE ser a localização física real do usuário,
        // que é enviada no originLat e originLng. Caso originLat/Lng não estejam presentes ou sejam inválidos
        // (por exemplo, string vazia, "null" ou "undefined"), tentamos usar o lat/lng da busca.
        // O parseFloat retorna NaN se a string não for um número válido.
        let userRealLat = parseFloat(originLat);
        let userRealLng = parseFloat(originLng);

        if (isNaN(userRealLat) || isNaN(userRealLng)) {
            userRealLat = parseFloat(lat);
            userRealLng = parseFloat(lng);
        }

        const apiKey = process.env.GOOGLE_PLACES_API_KEY;
        console.log('--- DEBUG API KEY ---');
        console.log('Key length:', apiKey ? apiKey.length : 'UNDEFINED');
        
        if (!apiKey) {
            return res.status(500).json({ error: 'API Key não configurada no servidor.' });
        }

        let searchUrl;
        let searchParams = {
            key: apiKey
        };

        if (pagetoken) {
            // Se modo livre, usa textsearch para continuar a paginação corretamente
            if (!mode || mode === 'free') {
                searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${pagetoken}&key=${apiKey}`;
            } else {
                searchUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${pagetoken}&key=${apiKey}`;
            }
            
            // Zeramos params para não enviar nada extra via axios
            searchParams = {};
            
            console.log(`Buscando próxima página com token: ${pagetoken.substring(0, 10)}... (Modo: ${mode || 'free'})`);
        } else {
            // Lógica de Modos:
            // Modo A (Livre) -> 'free' ou undefined: Text Search (busca global/inteligente)
            // Modo B/C (Restrito) -> Nearby Search com Radius
            
            if (!mode || mode === 'free') {
                // MODO LIVRE: Text Search
                // Text Search acha "Melissa" em "Sorriso" mesmo estando em "Campo Novo".
                // Ele aceita location/radius como bias, mas não restrição.
                
                searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json`;
                searchParams.query = keyword; // TextSearch usa 'query', não 'keyword'
                
                // Opcional: Adicionar location bias para priorizar resultados perto, mas sem restringir
                if (lat && lng) {
                     searchParams.location = `${lat},${lng}`;
                     searchParams.radius = 1000000; // Raio de 1.000km
                }
                
                console.log(`Buscando por: ${keyword} (Modo Livre: Text Search, radius=1000km)`);
            } else {
                // MODOS RESTRITOS: Nearby Search
                searchUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json`;
                searchParams.location = `${lat},${lng}`;
                searchParams.keyword = keyword;
                searchParams.radius = 15000; // 15km
                
                console.log(`Buscando por: ${keyword} em ${lat}, ${lng} (Modo Restrito: Nearby Search, radius=15km)`);
            }
        }

        const searchResponse = await axios.get(searchUrl, { params: searchParams });
        
        if (searchResponse.data.status !== 'OK' && searchResponse.data.status !== 'ZERO_RESULTS') {
            console.error('Erro na API do Google:', searchResponse.data);
            return res.status(500).json({ error: 'Erro ao consultar o Google Places API', details: searchResponse.data });
        }

        const places = searchResponse.data.results;
        const nextPageToken = searchResponse.data.next_page_token;
        
        // Remover limite artificial de 10
        // const limitedPlaces = places.slice(0, 10); 
        // Vamos processar todos os 20 resultados que o Google mandar
        const placesToProcess = places;

        // 2. Buscar detalhes de cada local para obter telefone e foto oficial
        
        const detailedPlacesPromises = placesToProcess.map(async (place) => {
            const placeId = place.place_id;
            
            // Verificar cache no Supabase
            let cachedData = null;
            if (supabase) {
                try {
                    const { data, error } = await supabase
                        .from('places_cache')
                        .select('*')
                        .eq('place_id', placeId)
                        .single();
                    
                    if (data && !error) {
                        // Verificar se o cache é recente (ex: < 30 dias)
                        const lastUpdated = new Date(data.updated_at);
                        const thirtyDaysAgo = new Date();
                        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                        
                        if (lastUpdated > thirtyDaysAgo) {
                            cachedData = data;
                        }
                    }
                } catch (e) {
                    console.error("Erro ao consultar cache:", e);
                }
            }

            if (cachedData) {
                // Usar dados do cache
                // Calcular distância
                let distanceKm = 0;
                if (!isNaN(userRealLat) && !isNaN(userRealLng) && cachedData.geometry && cachedData.geometry.location) {
                     distanceKm = getDistanceFromLatLonInKm(
                        userRealLat, 
                        userRealLng, 
                        cachedData.geometry.location.lat, 
                        cachedData.geometry.location.lng
                    );
                }
                
                // Formatar dados do cache para retorno
                
                // Tentar extrair cidade/estado do endereço formatado (fallback para cache antigo)
                // Padrão comum: "Rua X, 123 - Bairro, Cidade - UF, CEP"
                let cachedCity = null;
                let cachedState = null;
                
                if (cachedData.address) {
                    const parts = cachedData.address.split(',');
                    // Lógica muito básica, pode falhar, mas é um fallback
                    if (parts.length >= 2) {
                        // Tenta pegar o padrão "Cidade - UF"
                        // O último componente é geralmente CEP "78360-000" ou País "Brasil"
                        // O penúltimo é geralmente "Cidade - UF" ou "Cidade"
                        
                        // Vamos varrer de trás pra frente e ignorar o que parece CEP
                        for (let i = parts.length - 1; i >= 0; i--) {
                            let part = parts[i].trim();
                            // Regex simples para CEP (contém números e hífen ou apenas números e tem tamanho de CEP)
                            const isCep = /^\d{5}-?\d{3}$/.test(part) || /^\d+$/.test(part) || part === 'Brasil' || part === 'Brazil';
                            
                            // Se não for CEP/País e tiver texto, pode ser a cidade
                            if (!isCep && part.length > 2) {
                                // Tenta achar padrão "Cidade - UF" (com hífen e UF de 2 letras)
                                if (part.includes('-')) {
                                    const cityStateSplit = part.split('-');
                                    // Verifica se o segundo pedaço tem 2 letras (UF)
                                    // E se o primeiro pedaço NÃO contém números (para evitar "R. 08 - ...")
                                    const potentialState = cityStateSplit[cityStateSplit.length - 1].trim();
                                    const potentialCity = cityStateSplit.slice(0, -1).join('-').trim();
                                    
                                    // Valida se UF tem 2 letras maiúsculas
                                    // Valida se cidade não é código de estrada (MT-170)
                                    if (potentialState.length === 2 && /^[A-Z]{2}$/.test(potentialState) && !/^\d+$/.test(potentialCity)) {
                                        cachedState = potentialState;
                                        cachedCity = potentialCity;
                                        break;
                                    }
                                }
                                
                                // Se não achou com hífen válido, assume que é só a cidade SE:
                                // 1. O próximo componente era um estado válido
                                // 2. O componente atual NÃO tem números (evita ruas, BR-163, etc)
                                
                                // Verificar se parts[i+1] era o estado
                                if (i + 1 < parts.length) {
                                    const nextPart = parts[i+1].trim();
                                    if (nextPart.length === 2 && /^[A-Z]{2}$/.test(nextPart)) {
                                        // Validar se o componente atual não parece rua ou código
                                        if (!/\d/.test(part)) {
                                            cachedCity = part;
                                            cachedState = nextPart;
                                            break;
                                        }
                                    }
                                }
                                
                                // Se for o antepenúltimo e o penúltimo for UF, pega.
                                // Mas aqui no loop reverso, estamos tentando adivinhar.
                                // Vamos ser conservadores: só pegar se tiver certeza do UF.
                            }
                        }
                    }
                }

                let photoUrl = null;
                
                // Prioridade 1: URL pública já salva no Storage do Supabase
                if (cachedData.photo_url) {
                    photoUrl = cachedData.photo_url;
                } 
                // Prioridade 2: Referência antiga (para compatibilidade ou fallback)
                else if (cachedData.photos && Array.isArray(cachedData.photos) && cachedData.photos.length > 0) {
                    const photoRef = cachedData.photos[0].photo_reference;
                    // Se tiver referência mas não URL, vamos tentar baixar e salvar agora (Lazy Migration)
                    // Ou apenas usar o proxy antigo por enquanto.
                    // Para economizar, deveríamos idealmente processar isso em background, mas aqui vamos usar o proxy
                    photoUrl = `/foto?ref=${photoRef}`;
                }

                let openNow = null;
                
                // Função para calcular status 'Aberto' baseado no horário atual e periods salvos
                const calculateOpenNow = (openingHours) => {
                    if (!openingHours || !openingHours.periods) return null;
                    
                    const now = new Date();
                    // Ajuste básico de fuso horário: vamos assumir que o servidor está no mesmo fuso do usuário (ex: -04:00 MT ou -03:00 BRT)
                    // Ou melhor: usar o fuso do servidor e esperar que coincida.
                    // O Google Places retorna periods em dias 0-6 (Dom-Sab) e horas HHMM.
                    
                    const day = now.getDay();
                    const hours = now.getHours().toString().padStart(2, '0');
                    const minutes = now.getMinutes().toString().padStart(2, '0');
                    const currentTime = parseInt(hours + minutes);
                    
                    // Encontrar períodos para o dia de hoje
                    const todayPeriods = openingHours.periods.filter(p => p.open && p.open.day === day);
                    
                    if (todayPeriods.length === 0) return false; // Fechado hoje
                    
                    for (const period of todayPeriods) {
                        const openTime = parseInt(period.open.time);
                        let closeTime = period.close ? parseInt(period.close.time) : 2359; // Se não tem close, assume 24h ou até fim do dia
                        
                        // Tratamento para virada de dia (close time < open time, ex: abre 22h fecha 02h)
                        // Isso é complexo pois envolve periods de dias diferentes.
                        // Para simplificar, vamos assumir horários normais no mesmo dia.
                        
                        if (currentTime >= openTime && currentTime < closeTime) {
                            return true;
                        }
                    }
                    return false;
                };

                if (cachedData.opening_hours) {
                    // Tenta calcular o status atual em vez de usar o velho
                    const calculatedStatus = calculateOpenNow(cachedData.opening_hours);
                    if (calculatedStatus !== null) {
                        openNow = calculatedStatus;
                    } else if (typeof cachedData.opening_hours.open_now !== 'undefined') {
                        // Fallback para o valor salvo se não conseguir calcular
                         openNow = cachedData.opening_hours.open_now;
                    }
                }

                return {
                    id: placeId,
                    name: cachedData.name,
                    address: cachedData.address,
                    city: cachedCity,
                    state: cachedState,
                    phone: cachedData.phone,
                    rating: cachedData.rating || 'N/A',
                    // Formatando a distância para o padrão brasileiro (1.616,8)
                    distance: distanceKm.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                    rawDistance: distanceKm, // Campo auxiliar para ordenação
                    photo: photoUrl,
                    googleMapsUrl: cachedData.google_maps_url,
                    location: cachedData.geometry ? cachedData.geometry.location : null,
                    openNow: openNow
                };
            }

            // Se não tiver cache, buscar na API do Google
            const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json`;
            const detailsParams = {
                place_id: placeId,
                // Adicionando address_components para extrair cidade e estado
                fields: 'name,formatted_address,address_components,formatted_phone_number,rating,photos,geometry,url,opening_hours',
                key: apiKey
            };

            try {
                const detailsResponse = await axios.get(detailsUrl, { params: detailsParams });
                const details = detailsResponse.data.result;

                // Extrair cidade e estado
                let city = '';
                let state = '';
                if (details.address_components) {
                    details.address_components.forEach(comp => {
                        if (comp.types.includes('locality')) {
                            city = comp.long_name;
                        }
                        if (comp.types.includes('administrative_area_level_1')) {
                            state = comp.short_name;
                        }
                    });
                }
                
                // Fallback se locality não existir (ex: vilarejos)
                if (!city && details.address_components) {
                     details.address_components.forEach(comp => {
                        if (comp.types.includes('administrative_area_level_2')) {
                            city = comp.long_name;
                        }
                    });
                }

                // Pegar a primeira foto se existir e salvar no Storage
                let photoUrl = null;
                let storagePhotoUrl = null;

                if (details.photos && details.photos.length > 0) {
                    const photoReference = details.photos[0].photo_reference;
                    // Tentar baixar e salvar no Supabase Storage
                    if (supabase) {
                        try {
                            const googlePhotoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${photoReference}&key=${apiKey}`;
                            const photoResponse = await axios.get(googlePhotoUrl, { responseType: 'arraybuffer' });
                            const buffer = Buffer.from(photoResponse.data, 'binary');
                            const fileName = `${placeId}.jpg`;

                            const { data: uploadData, error: uploadError } = await supabase
                                .storage
                                .from('place_photos')
                                .upload(fileName, buffer, {
                                    contentType: 'image/jpeg',
                                    upsert: true
                                });

                            if (!uploadError) {
                                const { data: publicUrlData } = supabase
                                    .storage
                                    .from('place_photos')
                                    .getPublicUrl(fileName);
                                
                                storagePhotoUrl = publicUrlData.publicUrl;
                                photoUrl = storagePhotoUrl; // Usar URL do Storage
                            } else {
                                console.error("Erro upload Storage:", uploadError);
                                photoUrl = `/foto?ref=${photoReference}`; // Fallback
                            }
                        } catch (photoErr) {
                            console.error("Erro ao processar foto para Storage:", photoErr.message);
                            photoUrl = `/foto?ref=${photoReference}`; // Fallback
                        }
                    } else {
                        photoUrl = `/foto?ref=${photoReference}`;
                    }
                }

                // Verificar status de abertura
                let openNow = null;
                if (details.opening_hours && typeof details.opening_hours.open_now !== 'undefined') {
                    openNow = details.opening_hours.open_now;
                }
                
                // Salvar no Cache Supabase
                if (supabase && details) {
                    try {
                        await supabase
                            .from('places_cache')
                            .upsert({
                                place_id: placeId,
                                name: details.name,
                                address: details.formatted_address,
                                phone: details.formatted_phone_number || 'Telefone indisponível',
                                rating: details.rating || null,
                                photos: details.photos || [],
                                photo_url: storagePhotoUrl, // Salvar URL do Storage
                                geometry: details.geometry,
                                opening_hours: details.opening_hours,
                                google_maps_url: details.url,
                                updated_at: new Date().toISOString()
                            }, { onConflict: 'place_id' });
                    } catch (e) {
                        console.error("Erro ao salvar no cache:", e);
                    }
                }

                // Calcular distância
                let distanceKm = 0;
                if (!isNaN(userRealLat) && !isNaN(userRealLng) && details.geometry && details.geometry.location) {
                     distanceKm = getDistanceFromLatLonInKm(
                        userRealLat, 
                        userRealLng, 
                        details.geometry.location.lat, 
                        details.geometry.location.lng
                    );
                }

                return {
                    id: placeId,
                    name: details.name,
                    address: details.formatted_address,
                    // Adicionar cidade e estado
                    city: city,
                    state: state,
                    phone: details.formatted_phone_number || 'Telefone indisponível',
                    rating: details.rating || 'N/A',
                    // Formatando a distância para o padrão brasileiro (1.616,8)
                    distance: distanceKm.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                    rawDistance: distanceKm, // Campo auxiliar para ordenação no servidor
                    photo: photoUrl,
                    googleMapsUrl: details.url, 
                    location: details.geometry.location,
                    openNow: openNow
                };
            } catch (error) {
                console.error(`Erro ao buscar detalhes do place ${placeId}:`, error.message);
                return null; 
            }
        });

        const results = await Promise.all(detailedPlacesPromises);
        let finalResults = results.filter(r => r !== null);
        
        // --- NOVO: BUSCAR ROTA EXATA USANDO GOOGLE DISTANCE MATRIX API ---
        // Agora, em vez de usar apenas a matemática aproximada, vamos perguntar ao Google a distância exata de carro.
        if (!isNaN(userRealLat) && !isNaN(userRealLng) && finalResults.length > 0) {
            try {
                // Pegar no máximo as 25 primeiras coordenadas (limite da API do Google)
                const placesForMatrix = finalResults.slice(0, 25);
                const destinationsParam = placesForMatrix.map(r => `${r.location.lat},${r.location.lng}`).join('|');
                const originParam = `${userRealLat},${userRealLng}`;
                
                // --- INÍCIO DO CACHE DE DISTÂNCIA ---
                // Verifica no banco se já calculamos essa mesma rota recentemente (ex: mesmo usuário pesquisando de novo ou vizinho)
                // Para não gerar infinitas combinações de latitude/longitude, podemos arredondar para 3 casas decimais 
                // (~110 metros de precisão), o que agrupa usuários da mesma rua/bairro num mesmo cache.
                const roundCoord = (coord) => Number(parseFloat(coord).toFixed(3));
                const originKey = `${roundCoord(userRealLat)},${roundCoord(userRealLng)}`;
                
                let distancesToFetch = []; // Locais que não estão no cache
                let cachedDistancesMap = {}; // Mapa para guardar os que achamos no cache
                
                if (supabase) {
                    try {
                        const { data: cachedDistances, error: cacheErr } = await supabase
                            .from('distance_cache')
                            .select('destination_place_id, distance_value')
                            .eq('origin_key', originKey)
                            .in('destination_place_id', placesForMatrix.map(p => p.id));
                            
                        if (!cacheErr && cachedDistances) {
                            cachedDistances.forEach(cd => {
                                cachedDistancesMap[cd.destination_place_id] = cd.distance_value;
                            });
                        }
                    } catch (err) {
                        console.error("Erro ao ler cache de distância:", err);
                    }
                }
                
                // Separar o que precisa buscar no Google do que já temos
                placesForMatrix.forEach(place => {
                    if (cachedDistancesMap[place.id]) {
                        // Já temos no cache!
                        const realDistanceKm = cachedDistancesMap[place.id] / 1000;
                        place.rawDistance = realDistanceKm;
                        place.distance = realDistanceKm.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
                    } else {
                        // Precisamos buscar no Google
                        distancesToFetch.push(place);
                    }
                });

                // Se houver algum local sem cache, chama a API do Google APENAS para eles
                if (distancesToFetch.length > 0) {
                    const destinationsParamToFetch = distancesToFetch.map(r => `${r.location.lat},${r.location.lng}`).join('|');
                    const dmUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originParam}&destinations=${destinationsParamToFetch}&key=${apiKey}&language=pt-BR`;
                    const dmResponse = await axios.get(dmUrl);

                    if (dmResponse.data.status === 'OK' && dmResponse.data.rows[0]) {
                        const elements = dmResponse.data.rows[0].elements;
                        let cacheInserts = [];
                        
                        distancesToFetch.forEach((place, index) => {
                            const element = elements[index];
                            if (element.status === 'OK' && element.distance) {
                                // Atualizar o objeto place
                                const realDistanceKm = element.distance.value / 1000;
                                place.rawDistance = realDistanceKm;
                                place.distance = realDistanceKm.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
                                
                                // Preparar para salvar no cache do Supabase
                                cacheInserts.push({
                                    origin_key: originKey,
                                    destination_place_id: place.id,
                                    distance_value: element.distance.value,
                                    updated_at: new Date().toISOString()
                                });
                            }
                        });
                        
                        // Salvar os novos cálculos no cache
                        if (supabase && cacheInserts.length > 0) {
                            try {
                                await supabase
                                    .from('distance_cache')
                                    .upsert(cacheInserts, { onConflict: 'origin_key, destination_place_id' });
                            } catch (err) {
                                console.error("Erro ao salvar cache de distância:", err);
                            }
                        }
                    } else {
                        console.error("Erro ou limite na Distance Matrix API:", dmResponse.data.status);
                    }
                }
            } catch (dmErr) {
                console.error("Falha ao consultar a Distance Matrix API:", dmErr.message);
                // Em caso de falha, ele mantém o fallback do getDistanceFromLatLonInKm já calculado no map
            }
        }
        
        // ORDENAÇÃO RIGOROSA POR DISTÂNCIA (Menor para Maior)
        // Isso garante que os resultados apareçam progressivamente do mais próximo para o mais distante.
        finalResults.sort((a, b) => a.rawDistance - b.rawDistance);
        
        // Retornar também o next_page_token para o frontend saber se tem mais
        // SE ESTIVER NO MODO LIVRE, NÃO RETORNAR TOKEN (LIMITAR A 20 RESULTADOS)
        let tokenToReturn = nextPageToken;
        if (!mode || mode === 'free') {
            tokenToReturn = null;
        }

        res.json({
            results: finalResults,
            nextPageToken: tokenToReturn
        });

    } catch (error) {
        console.error('Erro interno no servidor:', error);
        res.status(500).json({ error: 'Erro interno no servidor' });
    }
});

// Rota Proxy para Fotos (Para não expor a API Key)
app.get('/foto', async (req, res) => {
    const { ref } = req.query;
    if (!ref) return res.status(400).send('Referência de foto necessária');

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${ref}&key=${apiKey}`;

    try {
        const response = await axios.get(photoUrl, { responseType: 'stream' });
        response.data.pipe(res);
    } catch (error) {
        console.error('Erro ao buscar foto:', error.message);
        res.redirect('https://via.placeholder.com/400x300?text=Erro+Foto');
    }
});

// Função auxiliar para calcular distância aproximada de rota
// A fórmula de Haversine calcula a distância em "linha reta" (como o corvo voa).
// Em rodovias, a distância real percorrida é em média 25% a 35% maior que a linha reta.
// Para distâncias curtas (dentro da cidade), a diferença é menor. Para distâncias longas, é maior.
// Como não podemos usar a Directions API (custa muito caro para listar dezenas de locais),
// aplicamos um fator de correção baseado na distância para simular a rota rodoviária.
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raio da terra em km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const straightLineDistance = R * c; // Distância em linha reta
    
    // Fator de correção de rota (Routing factor)
    // Em média, a distância rodoviária é 1.2x a 1.4x a distância em linha reta no Brasil
    let routingFactor = 1.35; // Fator padrão para distâncias longas (ex: Campo Novo -> Cuiabá)
    
    if (straightLineDistance < 10) {
        routingFactor = 1.2; // Cidades / rotas urbanas
    } else if (straightLineDistance < 50) {
        routingFactor = 1.25; // Rotas intermunicipais curtas
    } else if (straightLineDistance < 100) {
        routingFactor = 1.3;
    }
    
    return straightLineDistance * routingFactor;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

// Iniciar servidor
if (process.env.NODE_ENV !== 'production') {
    const server = app.listen(PORT, () => {
        console.log(`Servidor rodando em http://localhost:${PORT}`);
    });
}

module.exports = app;

process.on('uncaughtException', (err) => {
    console.error('Erro não tratado (uncaughtException):', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Rejeição não tratada (unhandledRejection):', reason);
});
