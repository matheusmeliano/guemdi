// Variáveis globais
let userLat = null;
let userLng = null;
// Adicionando variáveis para a localização física real
let realUserLat = null;
let realUserLng = null;
let currentKeyword = "";
let nextPageToken = null;
let isLoading = false;
let searchMode = 'free'; // 'free' (default), 'current_city', 'manual_city'

// Elementos do DOM
const searchInput = document.getElementById('searchInput');
const locationStatus = document.getElementById('locationText');
const resultsContainer = document.getElementById('results');
const loadingElement = document.getElementById('loading');
const noResultsElement = document.getElementById('noResults');
const errorMsgElement = document.getElementById('errorMsg');
const mascotWelcome = document.getElementById('mascotWelcome');

const locationModal = document.getElementById('locationModal');
const citySearchInput = document.getElementById('citySearchInput');
const citySearchResults = document.getElementById('citySearchResults');

function initSmartStickySearchBox() {
    const searchBox = document.querySelector('.search-box');
    if (!searchBox) return;
    if (document.querySelector('.search-box.search-box--sticky[data-sticky-clone="true"]')) return;

    const stickyBox = searchBox.cloneNode(true);
    stickyBox.classList.add('search-box--sticky');
    stickyBox.setAttribute('data-sticky-clone', 'true');
    stickyBox.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    stickyBox.style.pointerEvents = 'none';
    document.body.appendChild(stickyBox);

    const showAfter = 250;
    const hideBefore = 200;
    const transitionMs = 220;
    let isVisible = false;
    let rafPending = false;
    let hideTimeoutId = null;

    const originalInput = document.getElementById('searchInput');
    const originalBtn = document.getElementById('searchBtn');
    const stickyInput = stickyBox.querySelector('input');
    const stickyBtn = stickyBox.querySelector('button');

    function syncStickyFromOriginal() {
        if (originalInput && stickyInput) {
            if (stickyInput.value !== originalInput.value) stickyInput.value = originalInput.value;
            stickyInput.placeholder = originalInput.placeholder;
            stickyInput.disabled = originalInput.disabled;
            stickyInput.style.cssText = originalInput.style.cssText;
        }
        if (originalBtn && stickyBtn) {
            stickyBtn.disabled = originalBtn.disabled;
            stickyBtn.style.cssText = originalBtn.style.cssText;
        }
    }

    syncStickyFromOriginal();

    function showSticky() {
        if (isVisible) return;
        isVisible = true;
        if (hideTimeoutId) {
            clearTimeout(hideTimeoutId);
            hideTimeoutId = null;
        }
        syncStickyFromOriginal();
        window.requestAnimationFrame(() => {
            stickyBox.classList.add('search-box--sticky-visible');
            stickyBox.style.pointerEvents = 'auto';
        });
    }

    function hideSticky() {
        if (!isVisible) return;
        isVisible = false;
        stickyBox.classList.remove('search-box--sticky-visible');
        stickyBox.style.pointerEvents = 'none';
        if (document.activeElement === stickyInput && originalInput) {
            originalInput.focus({ preventScroll: true });
        }
        if (hideTimeoutId) clearTimeout(hideTimeoutId);
        hideTimeoutId = setTimeout(() => {
            if (window.scrollY < hideBefore) stickyBox.classList.remove('search-box--sticky-visible');
        }, transitionMs + 30);
    }

    function applyState() {
        const y = window.scrollY || 0;
        if (y > showAfter) {
            showSticky();
        } else if (y < hideBefore) {
            hideSticky();
        }
    }

    function onScroll() {
        if (rafPending) return;
        rafPending = true;
        window.requestAnimationFrame(() => {
            rafPending = false;
            applyState();
        });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    if (stickyInput && originalInput) {
        stickyInput.addEventListener('input', () => {
            originalInput.value = stickyInput.value;
            originalInput.dispatchEvent(new Event('input', { bubbles: true }));
        });
        stickyInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchBusinesses();
        });
    }

    if (stickyBtn) {
        stickyBtn.addEventListener('click', () => searchBusinesses());
    }

    if (originalInput) {
        originalInput.addEventListener('input', syncStickyFromOriginal);
        new MutationObserver(syncStickyFromOriginal).observe(originalInput, { attributes: true, attributeFilter: ['disabled', 'style', 'placeholder'] });
    }
    if (originalBtn) {
        new MutationObserver(syncStickyFromOriginal).observe(originalBtn, { attributes: true, attributeFilter: ['disabled', 'style'] });
    }

    applyState();
}

// Inicializar aplicação
document.addEventListener('DOMContentLoaded', () => {
    // Garantir que as variáveis do modal sejam pegas após o DOM carregar, caso o script esteja no head ou antes do body fechar
    const modal = document.getElementById('locationModal');
    if (!locationModal && modal) {
        // Se as variáveis globais falharam por algum motivo, reatribui
        // Mas como o script está no final do body, deve funcionar.
    }

    getUserLocation();
    initSmartStickySearchBox();

    // Permitir buscar ao pressionar Enter
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchBusinesses();
        }
    });

    // Infinite Scroll e Scroll to Top
    window.addEventListener('scroll', () => {
        // Infinite Scroll logic
        if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
            if (!isLoading && nextPageToken) {
                loadMoreBusinesses();
            }
        }
        
        // Scroll to Top logic
        toggleScrollToTopButton();
    });

    // Animação do Mascote removida daqui, será chamada apenas quando a localização for confirmada
    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then(function(result) {
            result.onchange = function() {
                console.log('Permissão de geolocalização mudou para:', result.state);
                if (result.state === 'granted') {
                    // Se o usuário permitiu via navegador (cadeado), tenta pegar a localização imediatamente
                    // E esconde o alerta vermelho se estiver visível
                    const alertBox = document.getElementById('locationPermissionAlert');
                    if (alertBox) alertBox.classList.add('hidden');
                    
                    setUIBlocked(false); // Desbloquear UI

                    locationStatus.innerHTML = `<span style="font-size: 0.85rem;">Localizando...</span>`;
                    getCurrentLocationFromBrowser();
                } else if (result.state === 'denied') {
                    // BLOQUEIO TOTAL IMEDIATO
                    console.warn("Permissão de localização revogada pelo usuário.");
                    
                    // 1. Limpar variáveis de estado
                    userLat = null; userLng = null;
                    realUserLat = null; realUserLng = null;
                    
                    // 2. Limpar UI e esconder elementos liberados
                    locationStatus.innerHTML = `<span class="material-icons">location_off</span>`;
                    if (mascotWelcome) mascotWelcome.classList.add('hidden');
                    if (resultsContainer) resultsContainer.classList.add('hidden');
                    if (noResultsElement) noResultsElement.classList.add('hidden');
                    if (errorMsgElement) errorMsgElement.classList.add('hidden');
                    
                    // 3. Bloquear TODAS as opções de localização
                    setUIBlocked(true);

                    // 4. Mostrar Alerta Vermelho
                    const alertBox = document.getElementById('locationPermissionAlert');
                    if (alertBox) {
                        alertBox.classList.remove('hidden');
                        const alertText = alertBox.querySelector('p');
                        if (alertText) alertText.textContent = "Acesso à localização bloqueado. Por favor, permita o acesso clicando no ícone ao lado esquerdo na barra de endereço.";
                    }
                }
            };
        });
    }

    // Animação do Mascote removida daqui, será chamada apenas quando a localização for confirmada
});

// Função auxiliar para bloquear/desbloquear UI baseada na permissão (MOVIDA PARA ESCOPO GLOBAL)
function setUIBlocked(isBlocked) {
    const btnFreeMode = document.getElementById('btnFreeMode');
    const btnCurrentLocation = document.getElementById('btnCurrentLocation');
    const cityInput = document.getElementById('citySearchInput');
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    
    if (isBlocked) {
        if (btnFreeMode) {
            btnFreeMode.disabled = true;
            btnFreeMode.style.opacity = '0.6';
            btnFreeMode.style.cursor = 'not-allowed';
        }
        if (btnCurrentLocation) {
            btnCurrentLocation.disabled = true;
            btnCurrentLocation.style.opacity = '0.6';
            btnCurrentLocation.style.cursor = 'not-allowed';
        }
        if (cityInput) {
            cityInput.disabled = true;
            cityInput.style.opacity = '0.6';
            cityInput.style.cursor = 'not-allowed';
            cityInput.placeholder = 'Aguardando localização...';
        }
        if (searchInput) {
            searchInput.disabled = true;
            searchInput.style.opacity = '0.6';
            searchInput.style.cursor = 'not-allowed';
            searchInput.placeholder = 'Localização necessária...';
        }
        if (searchBtn) {
            searchBtn.disabled = true;
            searchBtn.style.opacity = '0.6';
            searchBtn.style.cursor = 'not-allowed';
        }
    } else {
        if (btnFreeMode) {
            btnFreeMode.disabled = false;
            btnFreeMode.style.opacity = '1';
            btnFreeMode.style.cursor = 'pointer';
        }
        if (btnCurrentLocation) {
            btnCurrentLocation.disabled = false;
            btnCurrentLocation.style.opacity = '1';
            btnCurrentLocation.style.cursor = 'pointer';
        }
        if (searchInput) {
            searchInput.disabled = false;
            searchInput.style.opacity = '1';
            searchInput.style.cursor = 'text';
            searchInput.placeholder = 'O que você procura? (ex: padaria, farmácia)';
        }
        if (searchBtn) {
            searchBtn.disabled = false;
            searchBtn.style.opacity = '1';
            searchBtn.style.cursor = 'pointer';
        }
    }
}

// Função do botão de subir ao topo
let lastScrollY = window.scrollY;
let isScrollingUp = false;

function toggleScrollToTopButton() {
    const scrollToTopBtn = document.getElementById('scrollToTopBtn');
    if (!scrollToTopBtn) return;
    
    const isMobile = window.innerWidth <= 767;
    const currentScrollY = window.scrollY;
    
    // Verifica se a grid de resultados NÃO está oculta (ou seja, tem busca ativa/feita)
    const isResultsVisible = !resultsContainer.classList.contains('hidden');
    
    // Lógica para detectar scroll para cima
    if (currentScrollY < lastScrollY) {
        isScrollingUp = true;
    } else {
        isScrollingUp = false;
    }
    
    // Verifica se chegou ao fundo da página (com margem de erro)
    const isBottom = (window.innerHeight + window.scrollY) >= document.body.offsetHeight - 50;

    if (isResultsVisible && currentScrollY > 300) {
        if (isMobile) {
            // Mobile: 
            // 1. Ocultar ao atingir o bottom (pedido explícito)
            // 2. Mostrar APENAS quando o usuário subir um pouco (isScrollingUp)
            
            if (isBottom) {
                scrollToTopBtn.classList.add('hidden');
            } else if (isScrollingUp) {
                scrollToTopBtn.classList.remove('hidden');
            } else {
                // Se estiver descendo (não chegou no fundo), mantém oculto ou visível?
                // O pedido diz "Só deverá aparecer novamente quando o usuário subir um pouco".
                // Isso sugere que ele deve sumir ao descer também, ou pelo menos sumir no fundo e SÓ reaparecer ao subir.
                // Para garantir o comportamento "sumir no fundo -> reaparecer ao subir", 
                // se ele estiver descendo e NÃO estiver no fundo, podemos manter o estado atual?
                // Não, vamos simplificar para UX limpa: Aparece ao subir, some ao descer/fundo.
                scrollToTopBtn.classList.add('hidden');
            }
        } else {
            // Desktop/Tablet: Sempre visível se scroll > 300 e resultados visíveis
            scrollToTopBtn.classList.remove('hidden');
        }
    } else {
        scrollToTopBtn.classList.add('hidden');
    }

    lastScrollY = currentScrollY;
}

// Scroll to Top Function
function scrollToTop() {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
}

// Animação do Mascote
function startMascotDialogue() {
    const mascotText = document.getElementById('mascotText');
    if (!mascotText) return;

    const dialogues = [
        { text: "Olá! 👋", class: "text-greeting" },
        { text: "Eu sou o Guemdi.", class: "text-intro" },
        { text: "Seu assistente local!", class: "text-intro" },
        { text: "Como posso ajudar?", class: "text-action" }
    ];

    let currentIndex = 0;

    // Função para atualizar o texto
    const updateText = () => {
        // Fade out
        mascotText.style.opacity = 0;

        setTimeout(() => {
            // Trocar texto e classe
            const dialogue = dialogues[currentIndex];
            mascotText.textContent = dialogue.text;
            mascotText.className = ""; // Limpar classes anteriores
            mascotText.classList.add(dialogue.class);
            
            // Fade in
            mascotText.style.opacity = 1;

            // Preparar próximo índice
            // Se chegou no último, para? Ou volta? 
            // O pedido diz "Começando por... Depois... e por fim...".
            // Então vamos parar no último.
            if (currentIndex < dialogues.length - 1) {
                currentIndex++;
                setTimeout(updateText, 2500); // Espera 2.5s para o próximo
            }
        }, 300); // Tempo do fade out
    };

    // Iniciar com o primeiro texto já aplicado
    const first = dialogues[0];
    mascotText.textContent = first.text;
    mascotText.className = first.class;
    
    // Agendar o próximo passo
    currentIndex++;
    setTimeout(updateText, 2000);
}

// 1. Obter Geolocalização do Usuário
function getUserLocation() {
    // Verificar se a permissão já está negada ANTES de confiar no cache
    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then(function(result) {
            if (result.state === 'denied') {
                console.warn("Permissão de localização já está negada. Bloqueando site.");
                
                // Forçar exibição do alerta imediatamente
                const alertBox = document.getElementById('locationPermissionAlert');
                if (alertBox) alertBox.classList.remove('hidden');
                
                handleLocationError({ code: 1, message: "Permissão negada (pré-verificação)" });
                setUIBlocked(true); // Bloquear botões e inputs
                // Não prossegue para carregar dados do cache
            } else {
                continueGetUserLocation();
            }
        }).catch(e => {
            console.error("Erro ao checar permissão:", e);
            continueGetUserLocation();
        });
    } else {
        continueGetUserLocation();
    }
}

function continueGetUserLocation() {
    // Tentar recuperar do localStorage imediatamente para exibir algo
    const savedCity = localStorage.getItem('userCity');
    const savedLat = localStorage.getItem('userLat');
    const savedLng = localStorage.getItem('userLng');
    const savedRealLat = localStorage.getItem('realUserLat');
    const savedRealLng = localStorage.getItem('realUserLng');
    const savedMode = localStorage.getItem('searchMode');

    if (savedMode) {
        searchMode = savedMode;
    }

    if (savedRealLat && savedRealLng) {
        realUserLat = parseFloat(savedRealLat);
        realUserLng = parseFloat(savedRealLng);
    }

    if (savedCity && savedLat && savedLng) {
        userLat = parseFloat(savedLat);
        userLng = parseFloat(savedLng);
        // Usar a função completa para garantir que mascote, input e alertas sejam atualizados corretamente
        updateLocationUI(savedCity, userLat, userLng);
    } else {
        // NÃO muda para "Localizando..." ainda. Deixa o ícone location_off (ou o que estiver)
        // getCurrentLocationFromBrowser vai decidir se muda ou não baseado na permissão.
        getCurrentLocationFromBrowser();
    }
}

// 1.1 Obter localização do navegador (GPS)
function getCurrentLocationFromBrowser() {
    if (navigator.geolocation) {
        // Verificar permissão antes de mostrar "Localizando..."
        if (navigator.permissions && navigator.permissions.query) {
            navigator.permissions.query({ name: 'geolocation' }).then(function(result) {
                if (result.state === 'denied') {
                    handleLocationError({ code: 1, message: "Permissão negada" });
                } else {
                    locationStatus.innerHTML = `<span style="font-size: 0.85rem;">Localizando...</span>`;
                    executeGeolocation();
                }
            }).catch(() => {
                locationStatus.innerHTML = `<span style="font-size: 0.85rem;">Localizando...</span>`;
                executeGeolocation();
            });
        } else {
            locationStatus.innerHTML = `<span style="font-size: 0.85rem;">Localizando...</span>`;
            executeGeolocation();
        }
    } else {
        locationStatus.innerHTML = `<span class="material-icons">location_off</span>`; 
        showError("Seu navegador não suporta geolocalização.");
    }
}

function executeGeolocation() {
    navigator.geolocation.getCurrentPosition(
        (position) => {
            // Sucesso!
            userLat = position.coords.latitude;
            userLng = position.coords.longitude;
            // Salvar a localização real também
            realUserLat = position.coords.latitude;
            realUserLng = position.coords.longitude;
            locationStatus.style.color = "white"; 
            
            fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${userLat}&lon=${userLng}&accept-language=pt-BR`)
                .then(response => {
                    if (!response.ok) throw new Error('Erro na API');
                    return response.json();
                })
                .then(data => {
                    if (data.error) throw new Error(data.error);
                    
                    const addr = data.address || {};
                    const city = addr.city || addr.town || addr.village || addr.municipality || addr.hamlet || addr.city_district || addr.suburb || addr.county || addr.state_district || addr.state || (data.display_name ? data.display_name.split(',')[0] : null) || "Sua localização";

                    updateLocationUI(city, userLat, userLng);
                })
                .catch((err) => {
                    console.error("Erro no reverse geocoding:", err);
                    // Fallback se não conseguir o nome da cidade
                    updateLocationUI("Sua localização", userLat, userLng);
                });

            console.log(`Localização: ${userLat}, ${userLng}`);
        },
        (error) => {
            // FALLBACK DE SEGURANÇA (Proteção contra recarregamentos rápidos)
            // Se der erro ou timeout, verifica se temos algo salvo no localStorage
            const savedCity = localStorage.getItem('userCity');
            const savedLat = localStorage.getItem('userLat');
            const savedLng = localStorage.getItem('userLng');
            
            // Só usa fallback se a permissão NÃO for explicitamente negada (code 1)
            if (error.code !== 1 && savedCity && savedLat && savedLng) {
                console.warn("GPS falhou/timeout, usando localização salva em cache como fallback.");
                userLat = parseFloat(savedLat);
                userLng = parseFloat(savedLng);
                
                const savedRealLat = localStorage.getItem('realUserLat');
                const savedRealLng = localStorage.getItem('realUserLng');
                if (savedRealLat) realUserLat = parseFloat(savedRealLat);
                if (savedRealLng) realUserLng = parseFloat(savedRealLng);
                
                updateLocationUI(savedCity, userLat, userLng);
            } else {
                handleLocationError(error);
            }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
}

// Funções do Modal de Localização
function openLocationModal() {
    const modal = document.getElementById('locationModal');
    const input = document.getElementById('citySearchInput');
    const results = document.getElementById('citySearchResults');
    
    if (modal) {
        modal.classList.remove('hidden');
        // Pequeno delay para garantir que o navegador processe a remoção do hidden antes de adicionar active
        setTimeout(() => {
            modal.classList.add('active');
        }, 10);
        
        if (input) {
            input.value = '';
            input.focus();
        }
        if (results) {
            results.innerHTML = '';
            results.classList.add('hidden');
        }
    } else {
        console.error("Modal de localização não encontrado no DOM");
    }
}

function closeLocationModal() {
    const modal = document.getElementById('locationModal');
    if (modal) {
        modal.classList.remove('active');
        // Espera a animação terminar antes de esconder (300ms é o tempo da transição no CSS)
        setTimeout(() => {
            modal.classList.add('hidden');
        }, 300);
    }
}

function setFreeMode() {
    // Verificar permissão antes de ativar o Modo Livre
    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then(function(result) {
            if (result.state === 'denied') {
                // Se negado, bloqueia e avisa
                closeLocationModal();
                const alertBox = document.getElementById('locationPermissionAlert');
                if (alertBox) {
                    alertBox.classList.remove('hidden');
                    const alertText = alertBox.querySelector('p');
                    if (alertText) alertText.textContent = "Acesso à localização bloqueado. Por favor, permita o acesso clicando no ícone ao lado esquerdo na barra de endereço.";
                }
                return; // Aborta
            }
            // Se permitido, prossegue
            executeFreeMode();
        });
    } else {
        executeFreeMode();
    }
}

function executeFreeMode() {
    closeLocationModal();
    searchMode = 'free';
    localStorage.setItem('searchMode', 'free');
    
    // Resetar userLat/userLng para a localização real se disponível
    if (realUserLat && realUserLng) {
        userLat = realUserLat;
        userLng = realUserLng;
        // Atualizar localStorage para refletir o modo livre
        localStorage.setItem('userLat', realUserLat);
        localStorage.setItem('userLng', realUserLng);
        // Opcional: Limpar o nome da cidade salva ou definir como "Modo Livre" para não confundir ao recarregar
        localStorage.removeItem('userCity');
        
        updateHeaderLocationUI("Modo Livre 🌍");
    } else {
        // Se não temos GPS, tentamos pegar agora
        locationStatus.innerHTML = `<span style="font-size: 0.85rem;">Localizando...</span>`;
        getCurrentLocationFromBrowser();
    }
}

function useCurrentLocation() {
    closeLocationModal();
    searchMode = 'current_city';
    localStorage.setItem('searchMode', 'current_city');
    
    // Verificação de permissão antes de "Localizando..."
    if (navigator.permissions && navigator.permissions.query) {
         navigator.permissions.query({ name: 'geolocation' }).then(function(result) {
             if (result.state === 'denied') {
                 // Se negado, bloqueia e avisa
                 handleLocationError({ code: 1, message: "Permissão negada" });
             } else {
                 locationStatus.innerHTML = `<span style="font-size: 0.85rem;">Localizando...</span>`;
                 executeGeolocation(); 
             }
         }).catch(() => {
             locationStatus.innerHTML = `<span style="font-size: 0.85rem;">Localizando...</span>`;
             executeGeolocation();
         });
    } else {
         locationStatus.innerHTML = `<span style="font-size: 0.85rem;">Localizando...</span>`;
         executeGeolocation();
    }
}

function updateLocationUI(city, lat, lng) {
    localStorage.setItem('userCity', city);
    localStorage.setItem('userLat', lat);
    localStorage.setItem('userLng', lng);
    
    userLat = lat;
    userLng = lng;

    updateHeaderLocationUI(city);
    
    // Esconder alerta de permissão se estiver visível
    const alertBox = document.getElementById('locationPermissionAlert');
    if (alertBox) {
        alertBox.classList.add('hidden');
    }
    
    // Habilitar busca de cidade manual e outras opções agora que temos localização
    setUIBlocked(false);
    enableCitySearch(); // Redundante se setUIBlocked já habilita? setUIBlocked não habilita cityInput explicitamente no false, lembra?
    // A nota dizia: "Nota: O input de cidade só é habilitado após obter a localização com sucesso (updateLocationUI)"
    // Então enableCitySearch continua necessário OU movemos a lógica para setUIBlocked(false).
    
    if (realUserLat && realUserLng) {
        localStorage.setItem('realUserLat', realUserLat);
        localStorage.setItem('realUserLng', realUserLng);
    }
    
    // Iniciar mascote APENAS se estivermos na "home" (sem resultados, sem erro, sem "não encontrado")
    const mascot = document.getElementById('mascotWelcome');
    const resultsContainer = document.getElementById('results');
    const noResults = document.getElementById('noResults');
    const errorMsg = document.getElementById('errorMsg');
    
    // Verifica se estamos em qualquer estado que NÃO seja a home limpa
    const isSearchActive = (resultsContainer && !resultsContainer.classList.contains('hidden')) || 
                          (noResults && !noResults.classList.contains('hidden')) ||
                          (errorMsg && !errorMsg.classList.contains('hidden'));
    
    if (mascot && mascot.classList.contains('hidden') && !isSearchActive) {
        mascot.classList.remove('hidden');
        startMascotDialogue();
    }
}

function enableCitySearch() {
    const input = document.getElementById('citySearchInput');
    if (input) {
        input.disabled = false;
        input.style.opacity = '1';
        input.style.cursor = 'text';
        input.placeholder = 'Digite a cidade para filtrar (Restrito)...';
    }
}

function updateHeaderLocationUI(displayText) {
    if (searchMode === 'free') {
        locationStatus.innerHTML = `<span>Modo Livre 🌍</span>`;
    } else {
        // Modos restritos mostram o cadeado
        locationStatus.innerHTML = `<span>${displayText} 🔒</span>`;
    }
}

// Buscar cidade na API do OpenStreetMap (Nominatim)
let searchTimeout;
function searchCity(query) {
    clearTimeout(searchTimeout);
    const resultsList = document.getElementById('citySearchResults'); // Garantir referência atualizada
    
    if (query.length < 3) {
        if (resultsList) {
            resultsList.innerHTML = '';
            resultsList.classList.add('hidden');
        }
        return;
    }

    searchTimeout = setTimeout(() => {
        if (!resultsList) return;
        
        resultsList.innerHTML = '<div class="city-result-item" style="color: #888;">Buscando...</div>';
        resultsList.classList.remove('hidden');

        // Adicionando addressdetails=1 para pegar estado corretamente
        fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=br&limit=5&accept-language=pt-BR&addressdetails=1`)
            .then(response => response.json())
            .then(data => {
                resultsList.innerHTML = '';
                
                if (data.length === 0) {
                    resultsList.innerHTML = '<div class="city-result-item" style="color: #888;">Nenhuma cidade encontrada</div>';
                    return;
                }

                data.forEach(place => {
                    const div = document.createElement('div');
                    div.className = 'city-result-item';
                    
                    // Formatar para "Cidade, Estado" (Ex: Tangará da Serra, MT)
                    let formattedName = place.display_name; // Fallback
                    
                    if (place.address) {
                        const city = place.address.city || place.address.town || place.address.village || place.address.municipality || place.name;
                        
                        // Tentar pegar a sigla do estado. O Nominatim as vezes retorna o nome completo.
                        // Mapeamento simples de estados seria ideal, mas vamos tentar pegar do address.
                        // O campo 'state' geralmente vem o nome completo "Mato Grosso".
                        // O campo 'ISO3166-2-lvl4' vem "BR-MT".
                        
                        let state = place.address.state;
                        
                        // Tentar transformar estado em sigla se possível (opcional, ou deixar nome)
                        // O usuário pediu "Tangará da Serra, MT".
                        // Vamos usar um dicionário rápido de siglas para BR
                        const statesMap = {
                            "Acre": "AC", "Alagoas": "AL", "Amapá": "AP", "Amazonas": "AM", "Bahia": "BA", "Ceará": "CE",
                            "Distrito Federal": "DF", "Espírito Santo": "ES", "Goiás": "GO", "Maranhão": "MA", "Mato Grosso": "MT",
                            "Mato Grosso do Sul": "MS", "Minas Gerais": "MG", "Pará": "PA", "Paraíba": "PB", "Paraná": "PR",
                            "Pernambuco": "PE", "Piauí": "PI", "Rio de Janeiro": "RJ", "Rio Grande do Norte": "RN",
                            "Rio Grande do Sul": "RS", "Rondônia": "RO", "Roraima": "RO", "Santa Catarina": "SC",
                            "São Paulo": "SP", "Sergipe": "SE", "Tocantins": "TO"
                        };
                        
                        if (state && statesMap[state]) {
                            state = statesMap[state];
                        }
                        
                        if (city && state) {
                            formattedName = `${city}, ${state}`;
                        } else if (city) {
                            formattedName = city;
                        }
                    }
                    
                    div.textContent = formattedName;
                    
                    div.onclick = () => {
                        searchMode = 'manual_city';
                        localStorage.setItem('searchMode', 'manual_city');

                        const cityName = formattedName.split(',')[0]; // Pega só o nome da cidade para a UI
                        updateLocationUI(cityName, parseFloat(place.lat), parseFloat(place.lon));
                        closeLocationModal();
                    };
                    
                    resultsList.appendChild(div);
                });
            })
            .catch(err => {
                console.error("Erro ao buscar cidades:", err);
                resultsList.innerHTML = '<div class="city-result-item" style="color: red;">Erro ao buscar</div>';
            });
    }, 500); 
}

// Fechar modal ao clicar fora
window.onclick = function(event) {
    const modal = document.getElementById('locationModal');
    if (event.target == modal) {
        closeLocationModal();
    }
}

// Tratamento de erros de geolocalização
function handleLocationError(error) {
    // ... (código de log) ...
    locationStatus.style.color = "white";
    console.log("Erro de localização:", error.message);
    
    // Bloquear todas as opções de localização (botões e input)
    setUIBlocked(true);

    // Mostrar alerta de permissão na tela
    const alertBox = document.getElementById('locationPermissionAlert');
    if (alertBox) {
        alertBox.classList.remove('hidden');
        const alertText = alertBox.querySelector('p');
        
        // Se for erro de permissão negada (code 1), explicar melhor
        if (error.code === 1) { // PERMISSION_DENIED
             locationStatus.innerHTML = `<span class="material-icons">location_off</span>`;
             if (alertText) alertText.textContent = "Acesso à localização bloqueado. Por favor, permita o acesso clicando no ícone ao lado esquerdo na barra de endereço.";
        } else {
             if (alertText) alertText.textContent = "Não foi possível obter sua localização. Tente novamente.";
        }
    }

    // Tentar recuperar do localStorage em caso de erro
    // IMPORTANTE: Se o erro for de permissão NEGADA explícita, NÃO devemos recuperar do localStorage
    // pois o usuário revogou o acesso. Mas aqui o handleLocationError pode ser chamado por timeout.
    // O ideal é checar se a permissão é 'denied' antes de tentar recuperar.
    // Mas como já temos a verificação inicial em getUserLocation, aqui assumimos que é fallback.
    // POREM, se o usuário revogou, o localStorage não deve ser usado.
    
    // Se a permissão estiver negada, não recupera
    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then(function(result) {
            if (result.state !== 'denied') {
                 // Só recupera se NÃO for denied (ex: timeout, erro de rede)
                 const savedCity = localStorage.getItem('userCity');
                 if (savedCity) {
                     locationStatus.innerHTML = `<span>${savedCity}</span>`;
                     // Se recuperou, talvez devesse desbloquear? 
                     // Mas handleLocationError é chamado quando FALHA.
                     // Se falhou mas tem cache, o código no getCurrentLocationFromBrowser (fallback) já cuida disso chamando updateLocationUI.
                     // Se chegou aqui, é porque falhou TUDO.
                 } else {
                     locationStatus.innerHTML = `<span class="material-icons">location_off</span>`;
                 }
            } else {
                locationStatus.innerHTML = `<span class="material-icons">location_off</span>`;
            }
        });
    } else {
        // Fallback antigo
        const savedCity = localStorage.getItem('userCity');
        if (savedCity) {
             locationStatus.innerHTML = `<span>${savedCity}</span>`;
        } else {
            locationStatus.innerHTML = `<span class="material-icons">location_off</span>`;
        }
    }
}

// Função chamada pelo botão do alerta para tentar novamente
function requestLocationPermission() {
    const alertBox = document.getElementById('locationPermissionAlert');
    if (alertBox) alertBox.classList.add('hidden'); // Esconder temporariamente enquanto tenta
    
    locationStatus.innerHTML = `<span style="font-size: 0.85rem;">Localizando...</span>`;
    getCurrentLocationFromBrowser();
}

// 2. Função de Busca
async function searchBusinesses() {
    const keyword = searchInput.value.trim();

    if (!keyword) {
        alert("Por favor, digite o que deseja buscar.");
        return;
    }

    if (!userLat || !userLng) {
        // Se tiver coordenadas salvas no localStorage, usa elas
        const savedLat = localStorage.getItem('userLat');
        const savedLng = localStorage.getItem('userLng');
        
        if (savedLat && savedLng) {
            userLat = parseFloat(savedLat);
            userLng = parseFloat(savedLng);
        } else {
            // Se não tem localização, força o modal a abrir para o usuário escolher
            openLocationModal();
            // Mostra aviso visual via alert
            alert("Para pesquisar, precisamos saber sua localização. Por favor, use sua localização atual ou digite sua cidade.");
            return;
        }
    }

    // Resetar estado
    currentKeyword = keyword;
    nextPageToken = null;
    isLoading = true;

    // LÓGICA DE LOCALIZAÇÃO (Alterada para "Modo Livre" por padrão)
    
    // 1. originLat/originLng: SEMPRE é a localização física REAL do usuário (para calcular rota e distância)
    // Força o uso da localização real se ela existir, garantindo que o cálculo seja da posição física do usuário até a loja
    const originLat = realUserLat !== null ? realUserLat : userLat;
    const originLng = realUserLng !== null ? realUserLng : userLng;

    // 2. searchLat/searchLng: Onde o Google vai procurar as empresas?
    // Lógica antiga: Usava userLat (que podia ser a cidade escolhida manualmente)
    // Lógica NOVA (Híbrida): 
    // - Se o usuário escolheu uma cidade MANUALMENTE (userCity setado e diferente de "Localização Atual"), respeita a cidade.
    // - Se o usuário usou "Localização Atual" (GPS), a busca é livre ao redor dele.
    
    // Como saber se foi manual? 
    // Podemos inferir: se realUserLat existe e é diferente de userLat (significa que usuário mudou a cidade manualmente),
    // então searchLat = userLat (cidade escolhida).
    // Se realUserLat existe e é igual a userLat (ou muito próximo), então searchLat = realUserLat.
    
    // Simplificação robusta:
    // Sempre usamos userLat/userLng para a busca. 
    // O segredo está em como definimos userLat/userLng na interface:
    // - Botão GPS: userLat = GPS
    // - Busca Cidade: userLat = Cidade
    
    // O pedido do usuário: "Localização fisica atual do usuário sempre deverá ser identificada. localização da cidade, deixar livre."
    // "Ou seja, no modo livre, será traçado uma rota da localização fisica atual do usuário até a loja mais próxima, mesmo que a mesma esteja em outra cidade."
    
    // Isso significa que se eu NÃO escolher cidade, a busca deve ser no GPS.
    // Se eu ESCOLHER cidade, a busca deve ser na cidade.
    // Isso JÁ É o comportamento atual do userLat.
    
    // O que precisa garantir é que o cálculo de distância e rota usem SEMPRE o GPS (realUserLat), 
    // independente do que está em userLat.
    // E isso JÁ FOI FEITO nas variáveis originLat/originLng acima.
    
    // O único ponto é: "localização da cidade, deixar livre."
    // Talvez ele queira que, se estiver no GPS, o raio de busca seja maior ou ilimitado?
    // O Google Places busca por "rankby=distance" ou "prominence" num raio.
    // Se não passarmos raio, ele tenta achar o mais relevante perto.
    
    const searchLat = userLat;
    const searchLng = userLng;

    // Limpar resultados anteriores e mostrar loading
    resultsContainer.innerHTML = '';
    resultsContainer.classList.add('hidden'); // Ocultar grid de resultados
    noResultsElement.classList.add('hidden');
    errorMsgElement.classList.add('hidden');
    mascotWelcome.classList.add('hidden'); // Ocultar mascote ao buscar
    loadingElement.classList.remove('hidden');

    try {
        // Fazer requisição ao nosso Backend
        // Passamos lat/lng para o Google Search (contexto da busca)
        // E passamos originLat/originLng para o cálculo de distância
        // E agora o modo de busca para o backend decidir o raio/rankby
        const response = await fetch(`/buscar?keyword=${encodeURIComponent(keyword)}&lat=${searchLat}&lng=${searchLng}&originLat=${originLat}&originLng=${originLng}&mode=${searchMode}`);
        
        if (!response.ok) {
            let errorMessage = 'Erro na resposta do servidor';
            try {
                const errorData = await response.json();
                if (errorData.error) errorMessage = errorData.error;
            } catch (e) {}
            throw new Error(errorMessage);
        }

        const data = await response.json();
        
        // Backend agora retorna { results: [], nextPageToken: "" }
        const places = data.results || data; // Fallback
        nextPageToken = data.nextPageToken;

        loadingElement.classList.add('hidden');
        isLoading = false;

        if (places.length === 0) {
            noResultsElement.classList.remove('hidden');
        } else {
            resultsContainer.classList.remove('hidden'); // Exibir grid se houver resultados
            renderResults(places);
        }

    } catch (error) {
        console.error("Erro na busca:", error);
        loadingElement.classList.add('hidden');
        isLoading = false;
        showError(`Ocorreu um erro ao buscar as empresas: ${error.message}`);
    }
}

// 3. Carregar Mais Empresas (Infinite Scroll)
async function loadMoreBusinesses() {
    if (!nextPageToken || isLoading) return;

    isLoading = true;
    loadingElement.classList.remove('hidden'); // Mostrar loading no final da lista

    // Carregar Mais Empresas (Infinite Scroll)
    const originLat = realUserLat !== null ? realUserLat : userLat;
    const originLng = realUserLng !== null ? realUserLng : userLng;

    // Retry logic: O Google pode demorar para ativar o token
    let attempts = 0;
    const maxAttempts = 3;
    
    const tryLoad = async () => {
        try {
            const response = await fetch(`/buscar?pagetoken=${nextPageToken}&lat=${userLat}&lng=${userLng}&originLat=${originLat}&originLng=${originLng}&mode=${searchMode}`);
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                // Se for erro INVALID_REQUEST, pode ser que o token ainda não esteja pronto
                if (attempts < maxAttempts) {
                    attempts++;
                    console.log(`Tentativa ${attempts} falhou, tentando novamente em 2s...`);
                    setTimeout(tryLoad, 2000); // Tentar novamente em 2s
                    return;
                }
                throw new Error(errorData.error || 'Erro ao carregar mais');
            }

            const data = await response.json();

            loadingElement.classList.add('hidden');
            isLoading = false;

            if (data.error) {
                console.error("Erro ao carregar mais:", data.error);
                return;
            }

            const places = data.results || [];
            nextPageToken = data.nextPageToken; // Atualizar token para a próxima página (se houver)

            console.log("Mais resultados carregados:", places.length); // Log para debug

            if (places.length > 0) {
                renderResults(places);
            } else {
                console.log("Nenhum resultado adicional encontrado nesta página.");
            }

        } catch (error) {
            console.error("Erro no infinite scroll:", error);
            // Se falhou todas as tentativas, parar o loading
            if (attempts >= maxAttempts) {
                loadingElement.classList.add('hidden');
                isLoading = false;
            }
        }
    };

    // Iniciar primeira tentativa com um pequeno delay inicial de segurança (1s)
    setTimeout(tryLoad, 1000);
}

// Função para gerar estrelas de avaliação
function generateStarRating(rating) {
    if (!rating || rating === 'N/A' || isNaN(rating)) {
        return `
            <div class="place-rating">
                <span style="font-size: 0.85rem; color: #777; font-style: italic;">Essa empresa não tem avaliação</span>
            </div>
        `;
    }
    
    const numericRating = parseFloat(rating);
    const fullStars = Math.floor(numericRating);
    const hasHalfStar = (numericRating % 1) >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
    
    let starsHtml = '';
    
    // Estrelas cheias
    for (let i = 0; i < fullStars; i++) {
        starsHtml += '<span class="material-icons" style="color: #FBC02D; font-size: 1.1rem;">star</span>';
    }
    
    // Meia estrela
    if (hasHalfStar) {
        starsHtml += '<span class="material-icons" style="color: #FBC02D; font-size: 1.1rem;">star_half</span>';
    }
    
    // Estrelas vazias
    for (let i = 0; i < emptyStars; i++) {
        starsHtml += '<span class="material-icons" style="color: #ccc; font-size: 1.1rem;">star_border</span>';
    }
    
    return `
        <div class="place-rating" style="display: flex; align-items: center;">
            ${starsHtml}
            <span style="font-weight: 600; margin-left: 5px; color: #333;">${rating}</span>
        </div>
    `;
}

// 4. Renderizar Resultados
function renderResults(places) {
    places.forEach(place => {
        const card = document.createElement('div');
        card.className = 'place-card';

        // Formatar telefone para link do WhatsApp
        const rawPhone = place.phone.replace(/\D/g, '');
        const whatsappLink = rawPhone ? `https://wa.me/${rawPhone}` : '#';
        const hasPhone = rawPhone.length > 0;
        const websiteUrl = place.website || '';
        let websiteHtml = '';

        if (websiteUrl) {
            websiteHtml = `
                <div class="place-info">
                    <span class="material-icons">language</span>
                    <a href="${websiteUrl.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer" style="color: var(--primary-color); text-decoration: none; font-weight: 500;">Visitar site</a>
                </div>
            `;
        }

        let imageHtml;
        if (place.photo) {
            imageHtml = `
                <div class="place-image-container">
                    <div class="place-image-placeholder">
                        <span style="font-weight: 700; font-size: 1.8rem; line-height: 1;">Guemdi</span>
                        <span style="font-size: 0.8rem; font-weight: 600;">Guia Empresarial Digital</span>
                    </div>
                    <img 
                        src="${place.photo}" 
                        alt="${place.name}" 
                        class="place-image" 
                        style="display: none;"
                        onload="this.style.display='block'; this.previousElementSibling.style.display='none';"
                        onerror="this.style.display='none'; this.previousElementSibling.style.display='flex';"
                    >
                </div>
            `;
        } else {
            imageHtml = `
                <div class="place-image-placeholder">
                    <span style="font-weight: 700; font-size: 1.8rem; line-height: 1;">Guemdi</span>
                    <span style="font-size: 0.8rem; font-weight: 600;">Guia Empresarial Digital</span>
                </div>
            `;
        }

        const ratingHtml = generateStarRating(place.rating);

        // Status de Aberto/Fechado
        let openingStatusHtml = '';
        if (place.openNow === true) {
            openingStatusHtml = `<span style="color: #34A853; font-weight: 600; font-size: 0.9rem;">Aberto agora</span>`;
        } else if (place.openNow === false) {
            openingStatusHtml = `<span style="color: #EA4335; font-weight: 600; font-size: 0.9rem;">Fechado</span>`;
        }

        // Montar HTML da Cidade/Estado acima do nome
        let cityStateHtml = '';
        if (place.city) {
            const stateSuffix = place.state ? ` - ${place.state}` : '';
            cityStateHtml = `<div class="place-city-state" style="font-size: 0.75rem; color: #888; font-weight: 600; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">${place.city}${stateSuffix}</div>`;
        }

        card.innerHTML = `
            <button class="place-share-btn" onclick="sharePlace('${place.name.replace(/'/g, "\\'")}', '${place.address.replace(/'/g, "\\'")}', '${place.googleMapsUrl || ''}')" title="Compartilhar">
                <span class="material-icons">share</span>
            </button>
            ${imageHtml}
            <div class="place-content">
                ${cityStateHtml}
                <h3 class="place-name">${place.name}</h3>
                <div style="display: flex; align-items: center; flex-wrap: wrap; margin-bottom: 5px;">
                    ${ratingHtml}
                </div>
                <div class="place-info">
                    <span class="material-icons">location_on</span>
                    <span>${place.address}</span>
                </div>
                <div class="place-info">
                    <span class="material-icons">phone</span>
                    <span>${place.phone}</span>
                </div>
                ${websiteHtml}
                <div class="place-distance" style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 5px;">
                    <span style="color: var(--primary-color); font-weight: 700;">Há ${place.distance} km de você</span>
                    ${openingStatusHtml}
                </div>
                
                <div class="place-actions">
                    <a href="https://www.google.com/maps/dir/?api=1&origin=${realUserLat},${realUserLng}&destination=${encodeURIComponent(place.address)}&destination_place_id=${place.id}" target="_blank" class="btn btn-map">
                        <span class="material-icons">map</span> Ver Rota
                    </a>
                    <a href="${whatsappLink}" target="_blank" class="btn btn-whatsapp ${!hasPhone ? 'btn-disabled' : ''}">
                        <i class="fab fa-whatsapp" style="font-size: 1.2rem;"></i> WhatsApp
                    </a>
                </div>
            </div>
        `;
        
        resultsContainer.appendChild(card);
    });
}

function showError(msg) {
    errorMsgElement.textContent = msg;
    errorMsgElement.classList.remove('hidden');
}

// 5. Função de Compartilhamento
async function sharePlace(name, address, url) {
    const shareText = `Veja este local que encontrei no Guemdi:\n\n*${name}*\n📍 ${address}\n\n${url ? `🔗 Link: ${url}` : ''}`;
    
    if (navigator.share) {
        try {
            await navigator.share({
                title: `Guemdi - ${name}`,
                text: shareText
            });
        } catch (err) {
            console.log('Compartilhamento cancelado ou falhou', err);
        }
    } else {
        // Fallback para navegadores que não suportam a Web Share API
        try {
            await navigator.clipboard.writeText(shareText);
            alert('Texto copiado para a área de transferência!');
        } catch (err) {
            console.error('Falha ao copiar: ', err);
            alert('Não foi possível compartilhar ou copiar o link.');
        }
    }
}
