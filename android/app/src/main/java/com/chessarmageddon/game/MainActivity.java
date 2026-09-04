package com.chessarmageddon.game;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Tela cheia no padrao de jogo: sem barra de status e sem barra de navegacao, e
 * um gesto na borda revela as barras so' por um instante.
 *
 * Quem ESCONDE as barras na subida e' o proprio Capacitor, pelo
 * `plugins.SystemBars.hidden` do `capacitor.config.json` - nao ha' nada a
 * duplicar aqui. O que a configuracao nao expoe e' o COMPORTAMENTO delas quando
 * o dedo encosta na tela, e e' justamente isso que separa jogo de aplicativo: no
 * padrao (`BEHAVIOR_DEFAULT`) um toque qualquer traz as barras de volta e elas
 * FICAM - num jogo de toque isso significa a interface do Android por cima do
 * jogo o tempo todo.
 *
 * A orientacao e' do manifesto (`android:screenOrientation="sensorLandscape"`):
 * configuracao nativa e declarativa, aplicada antes da primeira medicao da
 * janela. Travar por JavaScript chegaria tarde, dependeria de permissao do
 * navegador e piscaria em retrato no primeiro quadro.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        /*
         * Borda a borda explicito: a janela nao reserva espaco para as barras do
         * sistema, o conteudo e' que decide o que fazer com os recortes.
         *
         * Do Android 15 (API 35) em diante isto e' o padrao imposto ao
         * `targetSdk` 35+ e a chamada e' inofensiva; de 14 para tras e' ela que
         * garante o mesmo desenho, em vez de depender de as barras estarem
         * escondidas naquele instante. Substitui os antigos `SYSTEM_UI_FLAG_*`,
         * depreciados desde a API 30.
         */
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        /*
         * Deixa a janela desenhar por baixo do recorte (notch, camera) nas duas
         * bordas curtas - em paisagem, a esquerda e a direita. Sem isto o
         * Android reserva uma tarja ao lado do recorte e a tela "cheia" perde
         * uma faixa.
         *
         * O jogo ja' sabe desviar do recorte sozinho: o `index.html` publica os
         * `env(safe-area-inset-*)` e o `Viewport.js` afasta o HUD.
         *
         * So' vale de Android 9 a 14; do 15 em diante, com `targetSdk` 35+, o
         * sistema ja' desenha assim por padrao.
         */
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams params = getWindow().getAttributes();
            params.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(params);
        }

        /*
         * O comportamento imersivo: o gesto vindo da borda revela as barras
         * POR CIMA do jogo, sem redimensionar nada, e elas somem sozinhas. E' o
         * proprio sistema que as retira - nao ha' temporizador nem laco aqui.
         */
        systemBarsController().setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );

        aplicarRecuoDoTeclado();
    }

    /**
     * Unico recuo que a WebView aceita: a altura do TECLADO, e so' enquanto ele
     * estiver na tela.
     *
     * O plugin `SystemBars` do Capacitor, no modo `insetsHandling: "css"`
     * (o padrao), instala um ouvinte que recua a WebView pelos recortes do
     * sistema - inclusive o do RECORTE DE TELA, que continua existindo mesmo com
     * as barras escondidas. Em paisagem isso e' uma faixa vertical do lado do
     * notch, pintada com o fundo da janela: era a faixa branca. Por isso o
     * `capacitor.config.json` traz `insetsHandling: "disable"`, e por isso este
     * ouvinte pode existir sem disputar com o de la' (com "disable" o plugin nao
     * instala o dele; so' um ouvinte por View sobrevive).
     *
     * Sem nada no lugar, porem, o teclado da tela de nome cobriria o campo de
     * texto: numa janela borda a borda o sistema nao encolhe mais o conteudo
     * sozinho. Recuar SO' pelo `ime()` mantem o jogo em tela cheia (durante a
     * partida nao existe campo de texto, entao o recuo e' sempre zero) e devolve
     * o campo para cima do teclado quando ele aparece.
     *
     * Os recortes seguem intactos para a pagina: o ouvinte devolve os insets
     * como vieram, e e' deles que a WebView monta os `env(safe-area-inset-*)`.
     */
    private void aplicarRecuoDoTeclado() {
        if (getBridge() == null || getBridge().getWebView() == null) return;

        View conteudo = (View) getBridge().getWebView().getParent();
        if (conteudo == null) return;

        ViewCompat.setOnApplyWindowInsetsListener(conteudo, (view, insets) -> {
            int recuo = 0;
            if (insets.isVisible(WindowInsetsCompat.Type.ime())) {
                Insets teclado = insets.getInsets(WindowInsetsCompat.Type.ime());
                recuo = teclado.bottom;
            }
            view.setPadding(0, 0, 0, recuo);
            return insets;
        });
    }

    /**
     * Voltar do segundo plano (troca de app, notificacao, fechamento do teclado
     * da tela de nome) devolve as barras. Reesconder aqui e' o gancho de EVENTO
     * recomendado pelo Android: roda uma vez por retorno de foco.
     *
     * A revelacao transiente nao passa por aqui - ela nao tira o foco da
     * janela -, entao o gesto do usuario continua funcionando.
     */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);

        if (hasFocus) {
            systemBarsController().hide(WindowInsetsCompat.Type.systemBars());
        }
    }

    private WindowInsetsControllerCompat systemBarsController() {
        return WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    }
}
