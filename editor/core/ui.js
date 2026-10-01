// editor/core/ui.js
export const hasSweetAlert2 = () => typeof window !== 'undefined' && typeof window.Swal?.fire === 'function';

export const showConfirmDialog = async (text, options = {}) => {
    if (hasSweetAlert2()) {
        const result = await window.Swal.fire({
            text,
            icon: options.icon || 'question',
            showCancelButton: true,
            confirmButtonText: options.confirmButtonText || 'OK',
            cancelButtonText: options.cancelButtonText || 'Cancel',
            reverseButtons: options.reverseButtons ?? true,
            focusCancel: options.focusCancel ?? true,
            ...options.swal,
        });
        return !!result.isConfirmed;
    }
    return window.confirm(text);
};

export const showPromptDialog = async (title, defaultValue = '', options = {}) => {
    if (hasSweetAlert2()) {
        const result = await window.Swal.fire({
            title,
            input: 'text',
            inputValue: defaultValue ?? '',
            inputAutoTrim: true,
            showCancelButton: true,
            confirmButtonText: options.confirmButtonText || 'OK',
            cancelButtonText: options.cancelButtonText || 'Cancel',
            reverseButtons: options.reverseButtons ?? true,
            focusCancel: options.focusCancel ?? false,
            ...options.swal,
        });
        if (!result.isConfirmed) return null;
        return typeof result.value === 'string' ? result.value : '';
    }
    return window.prompt(title, defaultValue ?? '');
};

export const showAlertDialog = async (text, options = {}) => {
    if (hasSweetAlert2()) {
        await window.Swal.fire({
            text,
            icon: options.icon || 'info',
            confirmButtonText: options.confirmButtonText || 'OK',
            ...options.swal,
        });
        return;
    }
    window.alert(text);
};

export const showTopRightToast = (text, options = {}) => {
    if (hasSweetAlert2()) {
        window.Swal.fire({
            toast: true,
            position: 'top-end',
            text,
            icon: options.icon || 'info',
            showConfirmButton: false,
            timer: options.timer ?? 3200,
            timerProgressBar: true,
            ...options.swal,
        });
        return;
    }

    const toast = document.createElement('div');
    toast.textContent = String(text ?? '');
    toast.style.position = 'fixed';
    toast.style.top = '16px';
    toast.style.right = '16px';
    toast.style.zIndex = '250';
    toast.style.maxWidth = 'min(380px, calc(100vw - 24px))';
    toast.style.padding = '10px 12px';
    toast.style.borderRadius = '10px';
    toast.style.border = '1px solid rgba(96, 165, 250, 0.45)';
    toast.style.background = 'rgba(30, 64, 175, 0.95)';
    toast.style.color = '#dbeafe';
    toast.style.fontSize = '13px';
    toast.style.fontWeight = '600';
    toast.style.lineHeight = '1.4';
    toast.style.boxShadow = '0 12px 28px -12px rgba(15, 23, 42, 0.65)';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-6px)';
    toast.style.transition = 'opacity 180ms ease, transform 180ms ease';
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    const duration = Number(options.timer ?? 3200);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-6px)';
        setTimeout(() => toast.remove(), 200);
    }, Number.isFinite(duration) ? duration : 3200);
};
