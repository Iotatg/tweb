import {JSX, createSignal, onCleanup, onMount} from 'solid-js';

import Button from '@components/buttonTsx';
import MediaHeader from '@components/mediaHeader';
import cancelEvent from '@helpers/dom/cancelEvent';
import focusWhenSettled from '@helpers/dom/focusWhenSettled';
import bytesToHex from '@helpers/bytes/bytesToHex';
import {i18n, I18n} from '@lib/langPack';
import Modes from '@config/modes';
import IS_TOUCH_SUPPORTED from '@environment/touchSupport';
import parseSessionString from '@lib/accounts/parseSessionString';

import AuthCard from '@/pages/AuthCard';
import AuthCardError from '@/pages/AuthCardError';
import {CardSpec, useAuthFlow} from '@/pages/authFlow';
import styles from '@/pages/authFlow.module.scss';

if(import.meta.hot) import.meta.hot.accept();

type Spec = Extract<CardSpec, {name: 'signSession'}>;

/**
 * Signs in with a session string made by another Telegram client — Pyrogram,
 * GramJS/Telethon or gogram. The string is parsed locally into the DC and the
 * permanent auth key; the key is handed to the manager, which writes it into the
 * slot and lets the server tell who it belongs to. No phone number, login code
 * or cloud password is involved, so the app opens as if the account had always
 * been signed in.
 *
 * The string itself is never persisted: the card keeps it in a plain signal.
 */
export default function SignSessionCard(_props: {spec: Spec}) {
  const {managers, navigate, toIm} = useAuthFlow();

  const [sessionString, setSessionString] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [errorContent, setErrorContent] = createSignal<JSX.Element>();

  let textareaEl!: HTMLTextAreaElement;

  function onSubmit(e?: Event) {
    if(e) cancelEvent(e);
    if(submitting()) return;

    setErrorContent(undefined);

    let parsed: ReturnType<typeof parseSessionString>;
    try {
      parsed = parseSessionString(sessionString());
    } catch(err) {
      console.error('session string parse error:', err);
      setErrorContent(i18n('Login.Session.Invalid'));
      return;
    }

    if(parsed.isTest !== Modes.test) {
      setErrorContent(i18n('Login.Session.TestMismatch'));
      return;
    }

    setSubmitting(true);
    managers.appAccountManager.importSessionString(parsed.dcId, bytesToHex(parsed.authKey)).then(() => {
      toIm();
    }).catch((err: ApiError) => {
      setSubmitting(false);
      console.error('session import error:', err);

      // * the auth-key errors a foreign session can bring are not all in `ErrorType`
      switch(err.type as string) {
        case 'AUTH_KEY_UNREGISTERED':
        case 'AUTH_KEY_INVALID':
        case 'AUTH_KEY_DUPLICATED':
        case 'SESSION_REVOKED':
        case 'SESSION_INVALID':
        case 'USER_DEACTIVATED':
        case 'USER_DEACTIVATED_BAN':
          setErrorContent(i18n('Login.Session.Invalid'));
          break;
        default:
          setErrorContent(i18n('Error.AnError'));
          break;
      }
    });
  }

  /* ---------- lifecycle ---------- */

  let cancelFocus: (() => void) | undefined;
  onMount(() => {
    managers.appStateManager.pushToState('authState', {_: 'authStateSignSession'});

    if(!IS_TOUCH_SUPPORTED) {
      cancelFocus = focusWhenSettled(textareaEl, () => !submitting());
    }
  });

  onCleanup(() => {
    cancelFocus?.();
  });

  return (
    <AuthCard
      header={
        <MediaHeader>
          <MediaHeader.Title tag="h1">{i18n('Login.Session.Title')}</MediaHeader.Title>
          <MediaHeader.Subtitle class="secondary">{i18n('Login.Session.Subtitle')}</MediaHeader.Subtitle>
        </MediaHeader>
      }
    >
      <textarea
        ref={textareaEl}
        class={styles.sessionInput}
        value={sessionString()}
        placeholder={I18n.format('Login.Session.Placeholder', true)}
        aria-label={I18n.format('Login.Session.Label', true)}
        spellcheck={false}
        autocomplete="off"
        autocapitalize="off"
        dir="ltr"
        onInput={(e) => {
          setSessionString(e.currentTarget.value);
          setErrorContent(undefined);
        }}
        onKeyDown={(e) => {
          if((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            onSubmit(e);
          }
        }}
      />
      <AuthCardError content={errorContent()} describes={textareaEl} />
      <Button
        class="btn-primary btn-color-primary"
        disabled={!sessionString().trim() || submitting()}
        onClick={onSubmit}
      >
        {i18n('Login.Session.Button')}
        {submitting() && (
          <svg xmlns="http://www.w3.org/2000/svg" class="preloader-circular" viewBox="25 25 50 50">
            <circle class="preloader-path" cx="50" cy="50" r="20" fill="none" stroke-miterlimit="10"/>
          </svg>
        )}
      </Button>
      <Button
        class="btn-primary btn-secondary btn-primary-transparent primary"
        disabled={submitting()}
        onClick={() => navigate({name: 'signIn'})}
        text="Login.Session.Cancel"
      />
    </AuthCard>
  );
}
