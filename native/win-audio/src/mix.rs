// Mistura das capturas: cada app enche a própria fila e o mixer, num relógio fixo,
// soma um bloco de cada uma.

use std::collections::VecDeque;

pub const SAMPLE_RATE: usize = 48_000;
pub const CHANNELS: usize = 2;
// Bloco do mixer: 10 ms.
pub const BLOCK_FRAMES: usize = SAMPLE_RATE / 100;
pub const BLOCK_SAMPLES: usize = BLOCK_FRAMES * CHANNELS;

// Antes de tocar, a fila junta uma folga contra o jitter dos pacotes do WASAPI.
const PRIME_SAMPLES: usize = BLOCK_SAMPLES * 3;
// Atraso máximo tolerado; acima disso descarta o excesso (relógios divergentes).
const MAX_SAMPLES: usize = BLOCK_SAMPLES * 15;

#[derive(Default)]
pub struct Fifo {
    samples: VecDeque<f32>,
    primed: bool,
}

impl Fifo {
    pub fn push_i16(&mut self, data: &[i16]) {
        self.samples.extend(data.iter().map(|&s| s as f32 / 32768.0));
        self.trim();
    }

    pub fn push_silence(&mut self, samples: usize) {
        self.samples.extend(std::iter::repeat_n(0.0, samples));
        self.trim();
    }

    fn trim(&mut self) {
        if self.samples.len() > MAX_SAMPLES {
            // Mantém múltiplo de CHANNELS para não trocar esquerda e direita.
            let excess = self.samples.len() - PRIME_SAMPLES;
            self.samples.drain(..excess - excess % CHANNELS);
        }
    }

    // Soma em `out` o próximo bloco; sem dados suficientes contribui silêncio e
    // volta a juntar folga.
    pub fn mix_into(&mut self, out: &mut [f32]) {
        if !self.primed {
            if self.samples.len() < PRIME_SAMPLES {
                return;
            }
            self.primed = true;
        }
        if self.samples.len() < out.len() {
            self.primed = false;
            return;
        }
        let len = out.len();
        for (o, s) in out.iter_mut().zip(self.samples.drain(..len)) {
            *o += s;
        }
    }
}

pub fn clamp(block: &mut [f32]) {
    for s in block {
        *s = s.clamp(-1.0, 1.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn espera_folga_antes_de_tocar_e_soma_as_filas() {
        let mut a = Fifo::default();
        let mut b = Fifo::default();
        let mut out = vec![0.0; BLOCK_SAMPLES];
        a.push_i16(&vec![16384; BLOCK_SAMPLES]);
        a.mix_into(&mut out);
        assert!(out.iter().all(|&s| s == 0.0), "sem folga ainda não toca");

        a.push_i16(&vec![16384; BLOCK_SAMPLES * 2]);
        b.push_i16(&vec![16384; BLOCK_SAMPLES * 3]);
        a.mix_into(&mut out);
        b.mix_into(&mut out);
        assert!(out.iter().all(|&s| s == 1.0));
        clamp(&mut out);
        assert!(out.iter().all(|&s| s <= 1.0));
    }

    #[test]
    fn descarta_atraso_excessivo_sem_trocar_canais() {
        let mut f = Fifo::default();
        let data: Vec<i16> = (0..MAX_SAMPLES as i16 + 2).map(|i| if i % 2 == 0 { 0 } else { 100 }).collect();
        f.push_i16(&data);
        assert_eq!(f.samples.len(), PRIME_SAMPLES);
        assert_eq!(f.samples[0], 0.0, "primeira amostra continua sendo do canal esquerdo");
    }
}
