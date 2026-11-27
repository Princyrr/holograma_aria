import { useEffect, useRef, useState, type RefObject } from "react";
import {
  IdentityGreeting,
  STORAGE_KEY,
  SAMPLE_COUNT,
  greetingText,
  matchProfile,
  normalizeName,
  saveProfiles,
  validName,
  validateProfiles,
  type FaceProfile,
} from "./identity";
import {
  captureSamples,
  checkAbort,
  wait,
  type FaceObservation,
} from "./voice-enrollment";
const pageGreetings = new IdentityGreeting();
type Props = {
  video: RefObject<HTMLVideoElement>;
  active: boolean;
  registrationPage?: boolean;
  onEnabled: (enabled: boolean) => void;
};
export default function FaceRegistration({
  video,
  active,
  registrationPage = false,
  onEnabled,
}: Props) {
  const [profiles, setProfiles] = useState<FaceProfile[]>([]),
    [error, setError] = useState("");
  const [name, setName] = useState(""),
    [consent, setConsent] = useState(false);
  const [capturing, setCapturing] = useState(false),
    [notice, setNotice] = useState(""),
    [progress, setProgress] = useState(0);
  const preview = useRef<HTMLVideoElement>(null),
    profilesRef = useRef(profiles),
    mounted = useRef(true),
    busy = useRef(false),
    capturingRef = useRef(false);
  const engine = useRef<Promise<typeof import("./face-engine")> | null>(null),
    currentActive = useRef(active),
    greetings = useRef(pageGreetings);
  const recognized = useRef({ id: "", name: "", count: 0, at: 0 });
  function publishIdentity() {
    const value = recognized.current;
    window.dispatchEvent(
      new CustomEvent("aria-camera-identity", {
        detail: {
          name:
            currentActive.current &&
            value.count >= 3 &&
            performance.now() - value.at < 4000
              ? value.name
              : null,
        },
      }),
    );
  }
  function clearIdentity() {
    recognized.current = { id: "", name: "", count: 0, at: 0 };
    publishIdentity();
  }
  useEffect(() => {
    window.addEventListener("aria-request-camera-identity", publishIdentity);
    return () => {
      window.removeEventListener(
        "aria-request-camera-identity",
        publishIdentity,
      );
      clearIdentity();
    };
  }, []);
  const manualController = useRef<AbortController | null>(null),
    storageReady = useRef(false);
  profilesRef.current = profiles;
  currentActive.current = active;
  function load() {
    if (!engine.current)
      engine.current = import("./face-engine")
        .then(async (value) => {
          await value.loadFaceEngine();
          return value;
        })
        .catch((error) => {
          engine.current = null;
          throw error;
        });
    return engine.current;
  }
  function cancelCapture() {
    manualController.current?.abort();
    capturingRef.current = false;
    setCapturing(false);
    setProgress(0);
  }
  function commit(next: FaceProfile[]) {
    saveProfiles(next);
    clearIdentity();
    storageReady.current = true;
    profilesRef.current = next;
    setProfiles(next);
    onEnabled(true);
  }
  useEffect(() => {
    mounted.current = true;
    onEnabled(true);
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const values = saved ? validateProfiles(JSON.parse(saved)) : [];
      profilesRef.current = values;
      setProfiles(values);
      storageReady.current = true;
    } catch {
      setError(
        "Não foi possível ler o cadastro local. Você pode excluir os cadastros e começar novamente.",
      );
    }
    return () => {
      mounted.current = false;
      manualController.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!active) {
      cancelCapture();
      clearIdentity();
    }
    const element = preview.current;
    if (!element) return;
    if (registrationPage && active) {
      element.srcObject = video.current?.srcObject ?? null;
      void element.play().catch(() => {});
    } else element.srcObject = null;
    return () => {
      element.srcObject = null;
    };
  }, [active, registrationPage, video]);
  async function readObservations(
    signal: AbortSignal,
  ): Promise<FaceObservation[]> {
    while (busy.current) await wait(100, signal);
    checkAbort(signal);
    if (!currentActive.current || !mounted.current || document.hidden)
      throw new DOMException("Cadastro cancelado.", "AbortError");
    busy.current = true;
    try {
      const element = video.current;
      if (!element || element.readyState < 2)
        throw new Error("Ative a câmera antes de cadastrar.");
      const api = await load();
      checkAbort(signal);
      const found = await api.readFace(element);
      checkAbort(signal);
      return found.map((face) => ({
        descriptor: face.descriptor,
        score: face.detection.score,
        widthRatio: face.detection.box.width / element.videoWidth,
      }));
    } finally {
      busy.current = false;
    }
  }
  useEffect(() => {
    if (registrationPage || !active) return;
    let cancelled = false,
      failed = false,
      timer = 0;
    const prepared = new Set<string>();
    onEnabled(true);
    const scan = async () => {
      if (cancelled || !mounted.current) return;
      try {
        const element = video.current;
        if (
          !document.hidden &&
          !capturingRef.current &&
          !busy.current &&
          element &&
          element.readyState >= 2
        ) {
          busy.current = true;
          try {
            const api = await load();
            if (cancelled) return;
            const found = await api.readFace(element);
            if (cancelled || capturingRef.current) return;
            const now = performance.now();
            const person =
              found.length === 1
                ? matchProfile(found[0].descriptor, profilesRef.current)
                : null;
            if (person) {
              const text = greetingText(person);
              if (!prepared.has(text)) {
                prepared.add(text);
                window.dispatchEvent(
                  new CustomEvent("aria-prepare-greeting", {
                    detail: { text },
                  }),
                );
              }
            }
            const previous = recognized.current;
            recognized.current = {
              id: person?.id ?? "",
              name: person?.name ?? "",
              count: person
                ? previous.id === person.id
                  ? previous.count + 1
                  : 1
                : 0,
              at: now,
            };
            publishIdentity();
            const text = greetings.current.update(
              person,
              found.length === 1,
              now,
              found.length === 1 ? found[0].descriptor : undefined,
            );
            if (text)
              window.dispatchEvent(
                new CustomEvent(
                  person ? "aria-identity-greeting" : "aria-greeting",
                  { detail: { text } },
                ),
              );
            if (mounted.current)
              setNotice(
                found.length > 1
                  ? "Fique apenas você na câmera para reconhecer pelo nome."
                  : person
                    ? `${person.name} reconhecida.`
                    : found.length
                      ? "Rosto sem cadastro."
                      : "Aguardando uma pessoa aparecer.",
              );
          } finally {
            busy.current = false;
          }
        }
      } catch {
        clearIdentity();
        failed = true;
        if (!cancelled)
          setError(
            "Não foi possível iniciar a identificação local. Desligue e ative a câmera para tentar novamente, ou exclua o cadastro.",
          );
      } finally {
        if (!cancelled && !failed) timer = window.setTimeout(scan, 250);
      }
    };
    void scan();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, profiles, video, onEnabled, registrationPage]);
  async function enroll() {
    const personName = normalizeName(name);
    if (
      !registrationPage ||
      !active ||
      !consent ||
      !validName(personName) ||
      capturingRef.current
    )
      return;
    if (!storageReady.current) {
      setError(
        "Não consegui ler os cadastros anteriores. Exclua os cadastros inválidos antes de cadastrar novamente.",
      );
      return;
    }
    const controller = new AbortController();
    manualController.current = controller;
    capturingRef.current = true;
    setCapturing(true);
    setError("");
    setProgress(0);
    setNotice("Preparando o cadastro local…");
    try {
      const samples = await captureSamples({
        signal: controller.signal,
        read: () => readObservations(controller.signal),
        progress: (count, message) => {
          setProgress(count);
          setNotice(message);
        },
      });
      checkAbort(controller.signal);
      if (
        samples.some(
          (sample) =>
            !!matchProfile(new Float32Array(sample), profilesRef.current),
        )
      )
        throw new Error(
          "Este rosto já tem um cadastro. Exclua o cadastro anterior se quiser refazê-lo.",
        );
      commit([
        ...profilesRef.current,
        {
          id: crypto.randomUUID(),
          name: personName,
          descriptors: samples,
          consentedAt: new Date().toISOString(),
        },
      ]);
      setConsent(false);
      setNotice(
        `${personName} cadastrada. Volte para a Aria e ative a câmera para receber o cumprimento.`,
      );
    } catch (error) {
      if (!controller.signal.aborted && mounted.current)
        setError(
          error instanceof Error
            ? error.message
            : "Não foi possível salvar o cadastro neste navegador.",
        );
    } finally {
      if (manualController.current === controller) {
        manualController.current = null;
        capturingRef.current = false;
        if (mounted.current) setCapturing(false);
      }
    }
  }
  function remove(id?: string) {
    cancelCapture();
    try {
      const next = id
        ? profilesRef.current.filter((profile) => profile.id !== id)
        : [];
      commit(next);
      setError("");
      setNotice("Cadastro excluído deste navegador.");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "O navegador não permitiu excluir o cadastro.",
      );
    }
  }
  return (
    <>
      {!registrationPage && (active || profiles.length > 0) && (
        <small className="identity-status">
          {active
            ? notice || "Identificação local ativa."
            : "Cadastros salvos neste navegador."}
        </small>
      )}
      {!registrationPage && capturing && (
        <button
          className="aria-control-button"
          type="button"
          onClick={() => {
            cancelCapture();
            setNotice("Cadastro cancelado.");
          }}
        >
          Cancelar cadastro
        </button>
      )}
      {error && !registrationPage && (
        <p role="alert" className="identity-status">
          {error}
        </p>
      )}
      {registrationPage && (
        <section className="identity-card" aria-labelledby="identity-title">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void enroll();
            }}
          >
            <div className="identity-heading">
              <h2 id="identity-title">Seu cadastro</h2>
            </div>
            <p>
              Cadastre somente o seu próprio rosto. A comparação acontece neste
              computador. Salvamos apenas seu nome e uma representação
              matemática do rosto neste navegador, sem guardar fotos nem enviar
              imagens ao Google.As imagens e a representação do rosto ficam
              neste navegador.
            </p>
            {!active && (
              <p role="status">Ative a câmera no botão acima para começar.</p>
            )}
            <video
              ref={preview}
              autoPlay
              muted
              playsInline
              className="identity-preview"
              aria-label="Prévia da câmera para seu cadastro"
            />
            <label>
              Seu nome
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={capturing}
                maxLength={40}
                autoComplete="given-name"
              />
            </label>
            <label className="identity-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                disabled={capturing}
              />
              Autorizo o cadastro e a comparação do meu rosto neste navegador e
              o envio do meu nome reconhecido ao Google para gerar os
              cumprimentos e responder quem sou durante a conversa. Posso
              excluir meu cadastro abaixo.
            </label>
            <button
              type="submit"
              disabled={
                !active ||
                !consent ||
                !validName(normalizeName(name)) ||
                capturing
              }
            >
              {capturing
                ? `Capturando ${progress} de ${SAMPLE_COUNT}…`
                : "Cadastrar meu rosto"}
            </button>
            {capturing && (
              <button
                type="button"
                onClick={() => {
                  cancelCapture();
                  setNotice(
                    "Captura cancelada. Nenhum novo cadastro foi salvo.",
                  );
                }}
              >
                Cancelar captura
              </button>
            )}
            <p role="status" aria-live="polite">
              {notice}
            </p>
            {error && <p role="alert">{error}</p>}
            <h3>Cadastros neste navegador ({profiles.length})</h3>
            {profiles.length ? (
              profiles.map((profile) => (
                <div className="identity-person" key={profile.id}>
                  <span>{profile.name}</span>
                  <button
                    type="button"
                    disabled={capturing}
                    onClick={() => remove(profile.id)}
                  >
                    Excluir cadastro de {profile.name}
                  </button>
                </div>
              ))
            ) : (
              <p>Nenhuma pessoa cadastrada.</p>
            )}
            <button type="button" onClick={() => remove()} disabled={capturing}>
              Excluir todos os cadastros
            </button>
          </form>
        </section>
      )}
    </>
  );
}
