import React, { useState } from 'react';
import api from '../../services/api';
import './PaymentForm.css';

function formatCardNumber(value) {
  return value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
}

function formatExpiry(value) {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length >= 3) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
}

function validate(fields) {
  const errors = {};
  const cardDigits = fields.cardNumber.replace(/\s/g, '');
  if (cardDigits.length !== 16) errors.cardNumber = '카드 번호 16자리를 입력해주세요.';
  if (!fields.cardHolder.trim()) errors.cardHolder = '카드 소유자 이름을 입력해주세요.';
  const [mm, yy] = fields.expiry.split('/');
  if (!mm || !yy || parseInt(mm) < 1 || parseInt(mm) > 12) errors.expiry = '유효한 만료일을 입력해주세요. (MM/YY)';
  if (fields.cvv.length < 3) errors.cvv = 'CVV 3자리를 입력해주세요.';
  return errors;
}

export default function PaymentForm({ totalPrice, reservationId, holdLoading, holdError, onSuccess }) {
  const [fields, setFields] = useState({ cardNumber: '', cardHolder: '', expiry: '', cvv: '' });
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    let formatted = value;
    if (name === 'cardNumber') formatted = formatCardNumber(value);
    if (name === 'expiry') formatted = formatExpiry(value);
    if (name === 'cvv') formatted = value.replace(/\D/g, '').slice(0, 4);
    setFields((prev) => ({ ...prev, [name]: formatted }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate(fields);
    if (Object.keys(errs).length) { setErrors(errs); return; }

    if (!reservationId) { setApiError('좌석 점유 정보가 없습니다. 뒤로 가서 다시 시도해주세요.'); return; }
    setLoading(true);
    setApiError('');
    try {
      const paymentRes = await api.post('/v1/payments', {
        reservation_id: reservationId,
        payment_method: 'card',
        amount: totalPrice,
      });
      const paymentId = paymentRes?.data?.payment_id ?? paymentRes?.payment_id;
      const paidAt = paymentRes?.data?.created_at ?? paymentRes?.created_at ?? new Date().toISOString();

      onSuccess({ paymentId, paidAt });
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || '결제 처리 중 오류가 발생했습니다.';
      setApiError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (holdLoading) {
    return (
      <div className="payment-form">
        <div className="payment-form__title">카드 정보 입력</div>
        <div style={{ textAlign: 'center', padding: '2rem 0', color: '#6B7280', fontSize: '0.9rem' }}>
          좌석을 점유하는 중입니다...
        </div>
      </div>
    );
  }

  if (holdError) {
    return (
      <div className="payment-form">
        <div className="payment-form__title">카드 정보 입력</div>
        <div className="payment-form__error-banner">{holdError}</div>
      </div>
    );
  }

  return (
    <form className="payment-form" onSubmit={handleSubmit} noValidate>
      <div className="payment-form__title">카드 정보 입력</div>

      <div className="form-field">
        <label htmlFor="cardNumber">카드 번호</label>
        <div className="card-number-wrapper">
          <input
            id="cardNumber"
            name="cardNumber"
            type="text"
            inputMode="numeric"
            placeholder="0000 0000 0000 0000"
            value={fields.cardNumber}
            onChange={handleChange}
            className={errors.cardNumber ? 'error' : ''}
            autoComplete="cc-number"
          />
          <span className="card-icon">💳</span>
        </div>
        {errors.cardNumber && <span className="form-field__error">{errors.cardNumber}</span>}
      </div>

      <div className="form-field">
        <label htmlFor="cardHolder">카드 소유자 이름</label>
        <input
          id="cardHolder"
          name="cardHolder"
          type="text"
          placeholder="홍길동"
          value={fields.cardHolder}
          onChange={handleChange}
          className={errors.cardHolder ? 'error' : ''}
          autoComplete="cc-name"
        />
        {errors.cardHolder && <span className="form-field__error">{errors.cardHolder}</span>}
      </div>

      <div className="form-field__row">
        <div className="form-field">
          <label htmlFor="expiry">만료일 (MM/YY)</label>
          <input
            id="expiry"
            name="expiry"
            type="text"
            inputMode="numeric"
            placeholder="MM/YY"
            value={fields.expiry}
            onChange={handleChange}
            className={errors.expiry ? 'error' : ''}
            autoComplete="cc-exp"
          />
          {errors.expiry && <span className="form-field__error">{errors.expiry}</span>}
        </div>

        <div className="form-field">
          <label htmlFor="cvv">CVV</label>
          <input
            id="cvv"
            name="cvv"
            type="password"
            inputMode="numeric"
            placeholder="•••"
            value={fields.cvv}
            onChange={handleChange}
            className={errors.cvv ? 'error' : ''}
            autoComplete="cc-csc"
          />
          {errors.cvv && <span className="form-field__error">{errors.cvv}</span>}
        </div>
      </div>

      {apiError && <div className="payment-form__error-banner">{apiError}</div>}

      <button type="submit" className="payment-form__submit" disabled={loading}>
        {loading ? (
          <>
            <div className="payment-form__spinner" />
            결제 처리 중...
          </>
        ) : (
          `₩${totalPrice.toLocaleString()} 결제하기`
        )}
      </button>

      <div className="payment-form__security">
        🔒 SSL 암호화로 안전하게 보호됩니다
      </div>
    </form>
  );
}
