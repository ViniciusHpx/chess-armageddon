package com.chessarmageddon.game;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Tela cheia no padrão de jogo: sem barra de status e sem barra de navegação, e
 * um gesto na borda revela as barras só por um instante.
 *
 * Quem ESCONDE as barras na subida é o próprio Capacitor, pelo
 * `plugins.SystemBars.hidden` do `capacitor.config.json` — não há nada a
 * duplicar aqui. O que a configuração não expõe é o COMPORTAMENTO delas quando
 * o dedo encosta na tela, e é justamente isso que separa jogo de aplicativo: no
 * padrão (`BEHAVIOR_DEFAULT`) um toque qualquer traz as barras de volta e elas
 * FICAM — num jogo de toque isso significa a interface do Android por cima do
 * jogo o tempo todo.
 *
 * A orientação é do manifesto (`android:screenOrientation="sensorLandscape"`):
 * configuração nativa e declarativa, aplicada antes da primeira medição da
 * janela. Travar por JavaScript chegaria tarde, dependeria de permissão do
 * navegador e piscaria em retrato no primeiro quadro.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        /*
         * Deixa a janela desenhar por baixo do recorte (notch, câmera) nas duas
         * bordas curtas — em paisagem, a esquerda e a direita. Sem isto o
         * Android reserva uma tarja preta ao lado do recorte e a tela "cheia"
         * perde uma faixa.
         *
         * O jogo já sabe desviar do recorte sozinho: o `index.html` publica os
         * `env(safe-area-inset-*)` e o `Viewport.js` afasta o HUD.
         *
         * Só vale de Android 9 a 14; do 15 em diante, com `targetSdk` 35+, o
         * sistema já desenha assim por padrão.
         */
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams params = getWindow().getAttributes();
            params.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(params);
        }

        /*
         * O comportamento imersivo: o gesto vindo da borda revela as barras
         * POR CIMA do jogo, sem redimensionar nada, e elas somem sozinhas. É o
         * próprio sistema que as retira — não há temporizador nem laço aqui.
         */
        systemBarsController().setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
    }

    /**
     * Voltar do segundo plano (troca de app, notificação, fechamento do teclado
     * da tela de nome) devolve as barras. Reesconder aqui é o gancho de EVENTO
     * recomendado pelo Android: roda uma vez por retorno de foco.
     *
     * A revelação transiente não passa por aqui — ela não tira o foco da
     * janela —, então o gesto do usuário continua funcionando.
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
